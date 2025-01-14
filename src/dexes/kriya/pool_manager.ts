import { kriya_liquidity } from "../../config/packages";
import { logger, LogLevel, LogTopic } from "../../defs/logging";
import { PoolManagerWithClient, ConfigManagerWithClient  } from "../../defs/pool_manager";
import { check_dynamic, Dex, Model, Pool, Tick } from "../../defs/pools";
import { liquidity_window_to_liquidity, parse_liquidity_window_event, sleep, wait_for_call } from "../../utils";

import { Transaction } from "@mysten/sui/transactions";


export interface ConfigManagerKriya extends ConfigManagerWithClient {
    dex: Dex.Kriya,
    kriya_api_wait_ms: number,
    threshold_liquidity_usd_for_pool: number,
    update_liquidity_ms: number,
    pools_per_sui_liquidity_fetch_call: number,
    tick_window_size: number
}

export class PoolManagerKriya extends PoolManagerWithClient {
    last_call_kriya_api: number
    config: ConfigManagerKriya
    constructor(config: ConfigManagerKriya) {
        if (config.dex != Dex.Kriya) throw new Error(`${Dex.Kriya} manager called with ${config.dex} dex argument`)
        super(config);
        this.config = config;
        this.last_call_kriya_api = 0;
    }

    async call_kriya_pool_api_v2(condition_for_pool: (pool_info: KriyaBasicPoolInfoV2) => boolean): Promise<KriyaBasicPoolInfoV2[]> {

        const pools: KriyaBasicPoolInfoV2[] = [];

        if (Date.now()-this.last_call_kriya_api > this.config.kriya_api_wait_ms) {
            try {
                const response: KriyaApiPoolsV2Response = await (await 
                    fetch("https://api-service-81678480858.asia-northeast1.run.app/pools/v2", {
                      "headers": {
                        "accept": "*/*",
                      },
                      "body": null,
                      "method": "GET"
                    })).json();
                this.last_call_kriya_api = Date.now();
                if (response.status == 200) {
                    logger(this.config.debug, LogLevel.DEBUG, LogTopic.PROPOSE_POOLS, `Read Kriya pools`)
                    const new_pools = response.data.filter(condition_for_pool);
                    new_pools.forEach((pool) => pools.push(pool));
                }
                else {
                    logger(this.config.debug, LogLevel.ERROR, LogTopic.PROPOSE_POOLS, `Kriya API call v2 failed with code ${response.status}: ${response.message}`)
                }
            }
            catch (error) {
                logger(this.config.debug, LogLevel.ERROR, LogTopic.PROPOSE_POOLS, `Kriya API call v2 failed: ${(error as Error).message}`)
            }
        }    
        return pools;
    }

    async call_kriya_pool_api_v3(condition_for_pool: (pool_info: KriyaBasicPoolInfoV3) => boolean): Promise<KriyaBasicPoolInfoV3[]> {

        const pools: KriyaBasicPoolInfoV3[] = [];

        if (Date.now()-this.last_call_kriya_api > this.config.kriya_api_wait_ms) {
            try {
                const response: KriyaApiPoolsV3Response = await (await 
                    fetch("https://api-service-81678480858.asia-northeast1.run.app/pools/v3", {
                      "headers": {
                        "accept": "*/*",
                      },
                      "body": null,
                      "method": "GET"
                    })).json();
                this.last_call_kriya_api = Date.now();
                if (response.status == 200) {
                    logger(this.config.debug, LogLevel.DEBUG, LogTopic.PROPOSE_POOLS, `Read Kriya pools`)
                    const new_pools = response.data.filter(condition_for_pool);
                    new_pools.forEach((pool) => pools.push(pool));
                }
                else {
                    logger(this.config.debug, LogLevel.ERROR, LogTopic.PROPOSE_POOLS, `Kriya API call v3 failed with code ${response.status}: ${response.message}`)
                }
            }
            catch (error) {
                logger(this.config.debug, LogLevel.ERROR, LogTopic.PROPOSE_POOLS, `Kriya API call v3 failed: ${(error as Error).message}`)
            }
        }    
        return pools;
    }

    condition_for_pool(pool_info: KriyaBasicPoolInfoV2 | KriyaBasicPoolInfoV3): boolean {
        return Number(pool_info.tvl) > this.config.threshold_liquidity_usd_for_pool
    }

    parse_basic_pool_info_v2(pool_info: KriyaBasicPoolInfoV2): Pool {
        const model = pool_info.isStable ? Model.KriyaStable : Model.Amm 
        const pool: Pool = {
            address: pool_info.poolId, 
            dex: this.config.dex, 
            model: model, 
            coin_types: [pool_info.tokenX.coinType, pool_info.tokenY.coinType],
            pool_call_types: [pool_info.tokenX.coinType, pool_info.tokenY.coinType],
            static_fee: Math.floor((Number(pool_info.lpFeesPercent) +  Number(pool_info.protocolFeesPercent)))
        };
        
        return pool;
    }

    parse_basic_pool_info_v3(pool_info: KriyaBasicPoolInfoV3): Pool {
        const pool: Pool = {
            address: pool_info.poolId, 
            dex: this.config.dex, 
            model: Model.UniswapV3, 
            coin_types: [pool_info.tokenX.coinType, pool_info.tokenY.coinType],
            pool_call_types: [pool_info.tokenX.coinType, pool_info.tokenY.coinType],
            static_fee: Math.floor((Number(pool_info.lpFeesPercent) +  Number(pool_info.protocolFeesPercent)) * 10000),
            tick_spacing: pool_info.tickSpacing
        };
        
        return pool;
    }

    async propose_pools(): Promise<Pool[]> {
        const response_v2 = await this.call_kriya_pool_api_v2((pool_info) => this.condition_for_pool(pool_info));
        const pools_proposed_v2 = response_v2.map((pool_info) => this.parse_basic_pool_info_v2(pool_info));
        
        await sleep(this.config.kriya_api_wait_ms + 500);
        const response_v3 = await this.call_kriya_pool_api_v3((pool_info) => this.condition_for_pool(pool_info));
        const pools_proposed_v3 = response_v3.map((pool_info) => this.parse_basic_pool_info_v3(pool_info));
        
        const pools_proposed = pools_proposed_v2.concat(pools_proposed_v3);

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
        const package_id = kriya_liquidity; 
        
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
            const kriya_liquidity = await this.create_liquidity_fetch_txn_and_simulate(pools);
            this.last_sui_rpc_request_ms = Date.now();
            if (kriya_liquidity.length != pools.length) {
                throw new Error("Fetched liquidity does not match pools")
            }
            kriya_liquidity.forEach((liquidity_window, i)=> {
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

    async update_liquidity_v2(pools: Pool[]): Promise<boolean> { 
        try {
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
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const status: boolean[] = pools.map((_) => false);

        const indices_v2 = pools.map((pool, i) => {if (pool.model != Model.UniswapV3) {return i;} else {return -1}}).filter((index) => index > -1);
        const indices_v3 = pools.map((pool, i) => {if (pool.model == Model.UniswapV3) {return i;} else {return -1}}).filter((index) => index > -1);

        const status_v3 = await this.upgrade_to_dynamic_v3(pools.filter((pool) => pool.model == Model.UniswapV3));
        status_v3.forEach((success, i) => {status[indices_v3[i]] = success});

        const status_v2 = await this.update_liquidity_v2(pools.filter((pool) => pool.model != Model.UniswapV3));
        indices_v2.forEach((index) => {status[index] = status_v2});

        return status;
    }
    
    async upgrade_to_dynamic_v3(pools: Pool[]): Promise<boolean[]> {
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

    async update_v3(pools: Pool[]) {
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

    async update_v2(pools: Pool[]) {
        const pools_with_oldest_update =  pools.sort((a, b) => a.last_pull!.time_ms - b.last_pull!.time_ms)
        const pools_to_update = pools_with_oldest_update.filter((pool) => (Date.now() - pool.last_pull!.time_ms) > this.config.update_liquidity_ms)
        
        if (pools_to_update.length > 0) {
            const success = await this.update_liquidity_v2(pools_to_update);
            if (success) {
                pools_to_update.forEach((pool) => logger(this.config.debug, LogLevel.DEBUG, LogTopic.LIQUIDITY_UPDATE, `${pool.address} liquidity updated`))                    
            }                    
        }
    }

    async update(): Promise<void> {
        // eslint-disable-next-line no-constant-condition
        while (true) {
            await sleep(200);
            const pools = this.pools.filter((pool) => check_dynamic(pool))
            if (pools.length > 0) {
                const pools_v3 = pools.filter((pool) => pool.model! == Model.UniswapV3);
                if (pools_v3.length > 0) {
                    await this.update_v3(pools_v3);
                }
                const pools_v2 = pools.filter((pool) => pool.model! != Model.UniswapV3);
                if (pools_v2.length > 0) {
                    await this.update_v2(pools_v2);
                }
            }    
        }
    }
}

interface KriyaCoinInfo {
    coinType: string // coin type
    decimals: number,
    isVerified: boolean,
    price: number
}

interface KriyaBasicPoolInfoV2 {
    poolId: string, //address
    lpFeesPercent: string, // in 100 * bp also add protocolFeesPercent
    isStable: boolean,
    lpSupply: string,
    protocolFeesPercent: string, // in 100 * bp 
    volume: string,
    tokenX: KriyaCoinInfo,
    tokenY: KriyaCoinInfo,
    tvl: string, // in USD
    verified: boolean
}

interface KriyaApiPoolsV2Response {
    status: number,
    message: string,
    data: KriyaBasicPoolInfoV2[],
    timestamp: string
} 

interface KriyaBasicPoolInfoV3 {
    poolId: string, //address
    lpFeesPercent: string, // in percent
    protocolFeesPercent: string, // in percent
    volume24h: string,
    tokenX: KriyaCoinInfo,
    tokenY: KriyaCoinInfo,
    tvl: string, // in USD
    verified: boolean,
    tickSpacing: number,
    currentTickIndex: string,
    liquidity: string
}

interface KriyaApiPoolsV3Response {
    status: number,
    message: string,
    data: KriyaBasicPoolInfoV3[],
    timestamp: string
} 

export interface LiquidityWindow {
    current_liquidity: bigint,
    current_tick: number,
    tick_spacing: number,
    window_size: number, 
    ticks: Tick[]
}