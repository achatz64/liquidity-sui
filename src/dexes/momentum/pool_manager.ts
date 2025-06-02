import { momentum_liquidity } from "../../config/packages";
import { logger, LogLevel, LogTopic } from "../../defs/logging";
import { PoolManagerWithClientAndLiquidityContract, ConfigManagerWithClientAndLiquidityContract  } from "../../defs/pool_manager";
import { check_dynamic, Dex, Model, Pool, Tick } from "../../defs/pools";
import { parse_event, sleep, wait_for_call } from "../../utils";

import { Transaction } from "@mysten/sui/transactions";


export interface ConfigManagerMomentum extends ConfigManagerWithClientAndLiquidityContract {
    dex: Dex.Momentum,
    momentum_api_wait_ms: number,
    threshold_liquidity_usd_for_pool: number,
    update_liquidity_ms: number,
    pools_per_sui_liquidity_fetch_call: number
}

export class PoolManagerMomentum extends PoolManagerWithClientAndLiquidityContract {
    last_call_momentum_api: number
    config: ConfigManagerMomentum
    constructor(config: ConfigManagerMomentum) {
        if (config.dex != Dex.Momentum) throw new Error(`${Dex.Momentum} manager called with ${config.dex} dex argument`)
        super(config);
        this.config = config;
        this.last_call_momentum_api = 0;
    }

    async call_momentum_pool_api(condition_for_pool: (pool_info: MomentumBasicPoolInfo) => boolean): Promise<MomentumBasicPoolInfo[]> {
        let stop_requesting_pages: boolean = false;
        const pools: MomentumBasicPoolInfo[] = [];

        // loop not used 
        while (!stop_requesting_pages) {
            if (Date.now()-this.last_call_momentum_api > this.config.momentum_api_wait_ms) {
                const response: MomentumApiPoolsResponse  = await (await fetch("https://api.mmt.finance/pools/v3", {
                    "headers": {
                            "accept": "application/json, text/plain, */*",
                            },
                    "body": null,
                    "method": "GET"
                    })).json();
                this.last_call_momentum_api = Date.now();
                if (response.status == 200) {
                    logger(this.config.debug, LogLevel.DEBUG, LogTopic.PROPOSE_POOLS, `Read Momentum pools`)
                    const new_pools = response.data.filter(condition_for_pool);
                    new_pools.forEach((pool) => pools.push(pool));
                    stop_requesting_pages = true;
                     
                }
                else {
                    logger(this.config.debug, LogLevel.ERROR, LogTopic.PROPOSE_POOLS, `Momentum API call failed with code ${response.status}: ${response.msg}`)
                }
            }
        }      
        return pools;
    }

    condition_for_pool(pool_info: MomentumBasicPoolInfo): boolean {
        return Number(pool_info.tvl) > this.config.threshold_liquidity_usd_for_pool
    }

    parse_basic_pool_info(pool_info: MomentumBasicPoolInfo): Pool {
        const pool: Pool = {
            address: pool_info.poolId, 
            dex: this.config.dex, 
            model: Model.UniswapV3, 
            coin_types: [pool_info.tokenXType, pool_info.tokenYType],
            // TODO: check
            pool_call_types: [pool_info.tokenXType, pool_info.tokenYType], 
            static_fee: Math.floor(Number(pool_info.lpFeesPercent) * 100 * 100),
            tick_spacing: pool_info.tickSpacing
        };
        
        return pool;
    }

    async propose_pools(): Promise<Pool[]> {
        const response = await this.call_momentum_pool_api((pool_info) => this.condition_for_pool(pool_info));
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

    async create_liquidity_fetch_txn_and_simulate(pools: Pool[]): Promise<Tick[][]> {   
        const package_id = momentum_liquidity; 
        
        const tx = new Transaction();
        
        for (const pool of pools) {
            const liquidity_vector = tx.moveCall({
                target: `${package_id}::liquidity::get_liquidity`,
                arguments: [tx.object(pool.address)],
                typeArguments: pool.coin_types!
            })
        
            tx.moveCall({
                target: `${package_id}::liquidity::emit_single_ticks`,
                arguments: [liquidity_vector[0]]
            })
        }

        const response = await this.simulateTransaction(tx) 
        const liquidity_vectors = response.transactionResponse.events.map((event)=> {
            const parsed = event.parsedJson as {'data': {index: {bits: string}, liquidity_net: {bits: string}}[]};
            return parse_event(parsed.data)
        })
        return liquidity_vectors
    }

    async update_liquidity(pools: Pool[]): Promise<boolean> { 
        await wait_for_call(this.last_sui_rpc_request_ms, this.config.sui_rpc_wait_time_ms);
        try {
            const momentum_liquidity = await this.create_liquidity_fetch_txn_and_simulate(pools);
            if (momentum_liquidity.length != pools.length) {
                throw new Error("Fetched liquidity does not match pools")
            }
            momentum_liquidity.forEach((ticks, i)=> {pools[i].liquidity = ticks});
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

interface MomentumCoinInfo {
    coinType: string,
    name: string,
    ticker: string,
    iconUrl: string,
    decimals: number,
    description: string,
    isVerified: boolean,
    isMmtWhitelisted: boolean,
    price: string,
}

interface MomentumBasicPoolInfo {
  poolId: string,
  tokenXType: string,
  tokenYType: string,
  tickSpacing: number,
  lpFeesPercent: string, //"0.0100",
  protocolFeesPercent: string, // "20.0000",
  isStable: boolean,
  currentSqrtPrice: string,
  currentTickIndex: string,
  liquidity: string,
  tokenXReserve: string,
  tokenYReserve: string,
  tvl: string, //"4030329.9198047966",
  volume24h: string, //"519858.562472040673407900",
  fees24h: string, //"51.992514037274454844",
  timestamp: string, //"2025-06-02T09:18:36.314Z",
  tokenX: MomentumCoinInfo,
  tokenY: MomentumCoinInfo,
}

interface MomentumApiPoolsResponse {
    status: number,
    msg: string,
    data: MomentumBasicPoolInfo[]   
}

