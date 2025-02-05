import { cetus_liquidity } from "../../config/packages";
import { logger, LogLevel, LogTopic } from "../../defs/logging";
import { PoolManagerWithClientAndLiquidityContract, ConfigManagerWithClientAndLiquidityContract  } from "../../defs/pool_manager";
import { check_dynamic, Dex, Model, Pool, Tick } from "../../defs/pools";
import { parse_event, sleep, wait_for_call } from "../../utils";

import { Transaction } from "@mysten/sui/transactions";


export interface ConfigManagerCetus extends ConfigManagerWithClientAndLiquidityContract {
    dex: Dex.Cetus,
    cetus_api_wait_ms: number,
    threshold_liquidity_usd_for_pool: number,
    update_liquidity_ms: number,
    pools_per_sui_liquidity_fetch_call: number
}

export class PoolManagerCetus extends PoolManagerWithClientAndLiquidityContract {
    last_call_cetus_api: number
    config: ConfigManagerCetus
    constructor(config: ConfigManagerCetus) {
        if (config.dex != Dex.Cetus) throw new Error(`${Dex.Cetus} manager called with ${config.dex} dex argument`)
        super(config);
        this.config = config;
        this.last_call_cetus_api = 0;
    }

    async call_cetus_pool_api(condition_for_pool: (pool_info: CetusBasicPoolInfo) => boolean): Promise<CetusBasicPoolInfo[]> {
        let stop_requesting_pages: boolean = false;
        let page: number = 1;
        const pools: CetusBasicPoolInfo[] = [];

        while (!stop_requesting_pages) {
            if (Date.now()-this.last_call_cetus_api > this.config.cetus_api_wait_ms) {
                const limit = 30;
                const response: CetusApiPoolsResponse = await (await fetch(`https://api-sui.cetus.zone/v2/sui/stats_pools?is_vaults=false&display_all_pools=false&has_mining=true&has_farming=true&no_incentives=true&order_by=-vol&limit=${limit}&offset=${(page-1) * limit}`, {
                    "headers": {
                      "accept": "*/*",
                    },
                    "body": null,
                    "method": "GET"
                  })).json();
                this.last_call_cetus_api = Date.now();
                if (response.code == 200) {
                    logger(this.config.debug, LogLevel.DEBUG, LogTopic.PROPOSE_POOLS, `Read page ${page} of Cetus pools`)
                    const new_pools = response.data.lp_list.filter(condition_for_pool);
                    if (new_pools.length == 0) {stop_requesting_pages = true;}
                    else {
                        new_pools.forEach((pool) => pools.push(pool));
                    }
                    page += 1;    
                }
                else {
                    logger(this.config.debug, LogLevel.ERROR, LogTopic.PROPOSE_POOLS, `Cetus API call failed with code ${response.code}: ${response.msg}`)
                }
            }
        }      
        return pools;
    }

    condition_for_pool(pool_info: CetusBasicPoolInfo): boolean {
        return Number(pool_info.pure_tvl_in_usd) > this.config.threshold_liquidity_usd_for_pool
    }

    parse_basic_pool_info(pool_info: CetusBasicPoolInfo): Pool {
        const pool: Pool = {
            address: pool_info.address, 
            dex: this.config.dex, 
            model: Model.UniswapV3, 
            coin_types: [pool_info.coin_a_address, pool_info.coin_b_address],
            pool_call_types: [pool_info.coin_a_address, pool_info.coin_b_address],
            static_fee: Math.floor(Number(pool_info.fee) * 100 * 10000),
            tick_spacing: pool_info.object.tick_spacing
        };
        
        return pool;
    }

    async propose_pools(): Promise<Pool[]> {
        const response = await this.call_cetus_pool_api((pool_info) => this.condition_for_pool(pool_info));
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
        const package_id = cetus_liquidity; 
        
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
            const cetus_liquidity = await this.create_liquidity_fetch_txn_and_simulate(pools);
            if (cetus_liquidity.length != pools.length) {
                throw new Error("Fetched liquidity does not match pools")
            }
            cetus_liquidity.forEach((ticks, i)=> {pools[i].liquidity = ticks});
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

interface CetusCoinInfo {
    name: string,
    symbol: string,
    decimals: number,
    address: string, // coin type
    balance: string,
    logo_url: string,
    coingecko_id: string,
    project_url: string,
    is_trusted: boolean,
  }

interface CetusBasicPoolInfo {
    address: string, //pool address
    coin_a: CetusCoinInfo // 
    coin_a_address: string, // coin type 
    coin_b: CetusCoinInfo, // 
    coin_b_address: string, // coin type
    fee: string, // float e.g. "0.0025"
    pure_tvl_in_usd: string,
    
    // pool object fields
    object: {
        coin_a: number, // amount of token
        coin_b: number, 
        current_sqrt_price: string,
        index: number,
        liquidity: string,
        tick_spacing: number
    }
}

interface CetusApiPoolsResponse {
    code: number,
    msg: string,
    data: {total: number, lp_list: CetusBasicPoolInfo[]}   
}

