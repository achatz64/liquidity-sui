import { bluefin_liquidity } from "../../config/packages";
import { logger, LogLevel, LogTopic } from "../../defs/logging";
import { PoolManagerWithClient, ConfigManagerWithClient  } from "../../defs/pool_manager";
import { check_dynamic, Dex, Model, Pool, Tick } from "../../defs/pools";
import { liquidity_window_to_liquidity, parse_liquidity_window_event, sleep, wait_for_call } from "../../utils";

import { Transaction } from "@mysten/sui/transactions";


export interface ConfigManagerBluefin extends ConfigManagerWithClient {
    dex: Dex.Bluefin,
    bluefin_api_wait_ms: number,
    threshold_liquidity_usd_for_pool: number,
    update_liquidity_ms: number,
    pools_per_sui_liquidity_fetch_call: number,
    tick_window_size: number
}

export class PoolManagerBluefin extends PoolManagerWithClient {
    last_call_bluefin_api: number
    config: ConfigManagerBluefin
    constructor(config: ConfigManagerBluefin) {
        if (config.dex != Dex.Bluefin) throw new Error(`${Dex.Bluefin} manager called with ${config.dex} dex argument`)
        super(config);
        this.config = config;
        this.last_call_bluefin_api = 0;
    }

    async call_bluefin_pool_api(condition_for_pool: (pool_info: BluefinBasicPoolInfo) => boolean): Promise<BluefinBasicPoolInfo[]> {

        const pools: BluefinBasicPoolInfo[] = [];

        if (Date.now()-this.last_call_bluefin_api > this.config.bluefin_api_wait_ms) {
            try {
                const response: BluefinApiPoolsResponse = await (await fetch("https://swap.api.sui-prod.bluefin.io/api/v1/pools/info", {
                    "headers": {
                    "accept": "application/json, text/plain, */*",
                    },
                    "body": null,
                    "method": "GET"
                    })).json();
                this.last_call_bluefin_api = Date.now();
                logger(this.config.debug, LogLevel.DEBUG, LogTopic.PROPOSE_POOLS, `Read Bluefin pools`)
                const new_pools = response.filter(condition_for_pool);
                new_pools.forEach((pool) => pools.push(pool));
            }
            catch (error) {
                logger(this.config.debug, LogLevel.ERROR, LogTopic.PROPOSE_POOLS, `Bluefin API call failed: ${(error as Error).message}`)
            }
        }    
        return pools;
    }

    condition_for_pool(pool_info: BluefinBasicPoolInfo): boolean {
        return Number(pool_info.tvl) > this.config.threshold_liquidity_usd_for_pool
    }

    parse_basic_pool_info(pool_info: BluefinBasicPoolInfo): Pool {
        const pool: Pool = {
            address: pool_info.address, 
            dex: this.config.dex, 
            model: Model.UniswapV3, 
            coin_types: [pool_info.tokenA.info.address, pool_info.tokenB.info.address],
            pool_call_types: [pool_info.tokenA.info.address, pool_info.tokenB.info.address],
            static_fee: Math.floor(Number(pool_info.feeRate) * 10000),
            tick_spacing: pool_info.config.tickSpacing
        };
        
        return pool;
    }

    async propose_pools(): Promise<Pool[]> {
        const response = await this.call_bluefin_pool_api((pool_info) => this.condition_for_pool(pool_info));
        const pools_proposed = response.map((pool_info) => this.parse_basic_pool_info(pool_info));
        const pools_proposed_addresses = pools_proposed.map((pool) => pool.address);
        
        // remove pools TODO: more rigid criteria
        const old_pools_negative = this.pools.filter((pool) => !pools_proposed_addresses.includes(pool.address));
        old_pools_negative.forEach(
            (pool) => {
                this.remove(pool.address);
            }
        )
        
        return pools_proposed
    }

    async upgrade_to_static(pools: Pool[]): Promise<boolean[]> {
        // upgrade not implemented 
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        return pools.map((_)=>false);
    }

    async create_liquidity_fetch_txn_and_simulate(pools: Pool[]): Promise<LiquidityWindow[]> {   
        const package_id = bluefin_liquidity; 
        
        const tx = new Transaction();
        
        for (const pool of pools) {
            const liquidity_vector = tx.moveCall({
                target: `${package_id}::liquidity::get_liquidity_window`,
                arguments: [tx.object(pool.address), tx.pure.u32(this.config.tick_window_size)],
                typeArguments: pool.coin_types!
            })
        
            tx.moveCall({
                target: `${package_id}::liquidity::emit_liquidity_window`,
                arguments: [liquidity_vector[0]]
            })
        }

        const response = await this.simulateTransaction(tx) 
        const liquidity_windows: LiquidityWindow[] = response.transactionResponse.events.map((event)=> {
            const parsed = event.parsedJson as {
                current_liquidity: string,
                current_tick: {bits: string},
                tick_spacing: string,
                window_size: string,
                ticks: {index: {bits: string}, liquidity_net: {bits: string}}[]
            };
            return parse_liquidity_window_event(parsed)
        })
        return liquidity_windows
    }

    async update_liquidity(pools: Pool[]): Promise<boolean> { 
        await wait_for_call(this.last_sui_rpc_request_ms, this.config.sui_rpc_wait_time_ms);
        try {
            const bluefin_liquidity = await this.create_liquidity_fetch_txn_and_simulate(pools);
            if (bluefin_liquidity.length != pools.length) {
                throw new Error("Fetched liquidity does not match pools")
            }
            bluefin_liquidity.forEach((liquidity_window, i)=> {
                pools[i].liquidity = liquidity_window_to_liquidity(liquidity_window);
            });
            pools.forEach((pool) => {pool.last_pull = {time_ms: Date.now(), success: true, counter: 0};})
            return true;
        }
        catch (error) {
            logger(this.config.debug, LogLevel.ERROR, LogTopic.LIQUIDITY_UPDATE, (error as Error).message);
            pools.forEach((pool) => {pool.last_pull = {time_ms: Date.now(), success: false, counter: pool.last_pull!.counter + 1};});
            return false;
        }
    }

    async upgrade_to_dynamic(pools: Pool[]): Promise<boolean[]> {
        let index = 0;
        const status: boolean[] = [];

        while (index < pools.length) {
            const pools_to_upgrade = pools.slice(index, Math.min(index + this.config.pools_per_sui_liquidity_fetch_call, pools.length));    
            const success_liquidity_update = await this.update_liquidity(pools_to_upgrade); 
            if (success_liquidity_update) {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                pools_to_upgrade.forEach((_) => {
                    status.push(success_liquidity_update)
                })
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                pools_to_upgrade.forEach((_) => {
                    status.push(success_liquidity_update)
                })
            }
            index = index + this.config.pools_per_sui_liquidity_fetch_call
        }
        return status;
    } 

    async update(): Promise<void> {
        // eslint-disable-next-line no-constant-condition
        while (true) {
            await sleep(200);
            const pools = this.pools.filter((pool) => check_dynamic(pool))
            if (pools.length > 0) {
                const l = Math.min(pools.length, this.config.pools_per_sui_liquidity_fetch_call);
                const pools_with_oldest_update =  pools.sort((a, b) => a.last_pull!.time_ms - b.last_pull!.time_ms).slice(0, l);
                const pools_to_update = pools_with_oldest_update.filter((pool) => (Date.now() - pool.last_pull!.time_ms) > this.config.update_liquidity_ms)
                
                if (pools_to_update.length > 0) {
                    const success = await this.update_liquidity(pools_to_update);
                    if (success) {
                        pools_to_update.forEach((pool) => logger(this.config.debug, LogLevel.DEBUG, LogTopic.LIQUIDITY_UPDATE, `${pool.address} liquidity updated`))                    
                    }                    
                }
            }    
        }
    }
}

interface BluefinCoinInfo {
    amount: string, // amount token
    info: {
        address: string, // coin type
        decimals: 6,
        isVerified: boolean,
    }
}

interface BluefinBasicPoolInfo {
    address: string,
    config: {
        tickSpacing: number,
    },
    feeRate: string, // in percent 
    symbol: string,
    tokenA: BluefinCoinInfo,
    tokenB: BluefinCoinInfo,
    tvl: string, // in USD
    verified: boolean
}

type BluefinApiPoolsResponse = BluefinBasicPoolInfo[]

export interface LiquidityWindow {
    current_liquidity: bigint,
    current_tick: number,
    tick_spacing: number,
    window_size: number, 
    ticks: Tick[]
}