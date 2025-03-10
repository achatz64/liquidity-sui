import { SuiObjectResponse } from "@mysten/sui/dist/cjs/client";
import { logger, LogLevel, LogTopic } from "../../defs/logging";
import { ConfigManagerWithClient, PoolManagerWithClient, ParsedSuiObjectInfo } from "../../defs/pool_manager";
import { check_dynamic, Dex, Model, Pool, Tick } from "../../defs/pools";
import { sleep, wait_for_call, to_signed_i32 } from "../../utils";

export interface ConfigManagerTurbos extends ConfigManagerWithClient {
    dex: Dex.Turbos,
    turbos_api_wait_ms: number,
    threshold_pool_propose_liquidity_usd_each_coin: number,
    update_liquidity_ms: number
}

export class PoolManagerTurbos extends PoolManagerWithClient {
    last_call_turbos_api: number
    config: ConfigManagerTurbos;
    constructor(config: ConfigManagerTurbos) {
        if (config.dex != Dex.Turbos) throw new Error(`${Dex.Turbos} manager called with ${config.dex} dex argument`)
        super(config);
        this.config = config;
        this.last_call_turbos_api = 0;
    }

    async call_turbos_pool_api(condition_for_pool: (pool_info: TurbosBasicPoolInfo) => boolean): Promise<TurbosBasicPoolInfo[]> {
        let stop_requesting_pages: boolean = false;
        let page: number = 1;
        const pools: TurbosBasicPoolInfo[] = [];

        while (!stop_requesting_pages) {
            if (Date.now()-this.last_call_turbos_api > this.config.turbos_api_wait_ms) {
                const response: TurbosApiPoolsResponse = await (await fetch(`https://api.turbos.finance/pools/v2?page=${page}&pageSize=100&orderBy=liquidity&category=&symbol=&includeRisk=true`, {
                    "headers": {
                        "accept": "application/json",
                        "content-type": "application/json",
                        "api-version": "v2"
                    },
                    "body": null,
                    "method": "GET"
                })).json();
                this.last_call_turbos_api = Date.now();
                logger(this.config.debug, LogLevel.DEBUG, LogTopic.PROPOSE_POOLS, `Read page ${page} of Turbos pools`)
                const new_pools = response.list.filter(condition_for_pool);
                if (new_pools.length == 0) {stop_requesting_pages = true;}
                else {
                    new_pools.forEach((pool) => pools.push(pool));
                }
                page += 1;
            }
        }
        
        return pools;
    }

    async call_turbos_liquidity_api(pool_address: string): Promise<TurbosTick[]> {
        const response: TurbosTick[] = await (await fetch(`https://api.turbos.finance/pools/ticks?poolId=${pool_address}`, {
            "headers": {
                "accept": "application/json",
                "content-type": "application/json",
                "api-version": "v2"
            },
            "body": null,
            "method": "GET"
        })).json();
        this.last_call_turbos_api = Date.now();
        return response
    }

    condition_for_pool(pool_info: TurbosBasicPoolInfo): boolean {
        return pool_info.coin_a_liquidity_usd > this.config.threshold_pool_propose_liquidity_usd_each_coin && pool_info.coin_b_liquidity_usd > this.config.threshold_pool_propose_liquidity_usd_each_coin
    }

    parse_basic_pool_info(pool_info: TurbosBasicPoolInfo): Pool {
        const pool: Pool = {
            address: pool_info.pool_id, 
            dex: this.config.dex, 
            model: Model.UniswapV3, 
            coin_types: [pool_info.coin_type_a, pool_info.coin_type_b],
            pool_call_types: [pool_info.coin_type_a, pool_info.coin_type_b, pool_info.fee_type],
            static_fee: Number(pool_info.fee),
            tick_spacing: Number(pool_info.tick_spacing),
        };
        
        return pool;
    }

    async propose_pools(): Promise<Pool[]> {
        const response = await this.call_turbos_pool_api((pool_info) => this.condition_for_pool(pool_info));
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

    parse_turbos_liquidity(tick: TurbosTick): Tick {
        return {tick_index: tick.index, liquidity_net: BigInt(tick.liquidity_net)}
    } 

    async update_liquidity(pool: Pool): Promise<boolean> {     
        await wait_for_call(this.last_call_turbos_api, this.config.turbos_api_wait_ms);
        try {
            const turbos_liquidity = await this.call_turbos_liquidity_api(pool.address);
            pool.liquidity = turbos_liquidity.map(this.parse_turbos_liquidity);
            pool.last_pull = {time_ms: Date.now(), success: true, counter: 0};
            return true;
        }
        catch (error) {
            logger(this.config.debug, LogLevel.ERROR, LogTopic.LIQUIDITY_UPDATE, (error as Error).message);
            pool.last_pull = {time_ms: Date.now(), success: false, counter: pool.last_pull!.counter + 1};
            return false;
        }
    }

    async upgrade_to_dynamic(pools: Pool[]): Promise<boolean[]> {
        const status: boolean[] = [];
        // assume sqrt_price is already init
        for (const pool of pools) {
            const successful_liquidity_update = await this.update_liquidity(pool); 
            status.push(successful_liquidity_update);
            if (successful_liquidity_update) {
                logger(this.config.debug, LogLevel.WORKFLOW, LogTopic.ADD_POOL, `${pool.address} liquidity initialized`)
            }
        }
        return status;
    }   

    async update(): Promise<void> {
        // eslint-disable-next-line no-constant-condition
        while (true) {
            await sleep(200);
            const pools = this.pools.filter((pool) => check_dynamic(pool))
            if (pools.length > 0) {
                const pool_with_oldest_update =  pools.sort((a, b) => a.last_pull!.time_ms - b.last_pull!.time_ms)[0];
                if (Date.now() - pool_with_oldest_update.last_pull!.time_ms > this.config.update_liquidity_ms){
                    const success = await this.update_liquidity(pool_with_oldest_update);
                    if (success) {
                        logger(this.config.debug, LogLevel.DEBUG, LogTopic.LIQUIDITY_UPDATE, `${pool_with_oldest_update.address} liquidity updated`)
                    }
                }
            }    
        }
    }

    parse_object(sui_object: SuiObjectResponse): ParsedSuiObjectInfo {
        const address = sui_object.data?.objectId;
        const content = sui_object.data!.content as unknown as {
            fields: {
                coin_a: string,
                coin_b: string,
                liquidity: string,
                fee: number, 
                sqrt_price: string,
                tick_current_index: {
                    type: string,
                    fields: {
                        bits: number
                    }
                }
            } 
        };
        const liquidity = BigInt(content.fields.liquidity);
        const sqrt_price = BigInt(content.fields.sqrt_price); 
        const current_tick_index = to_signed_i32({bits: content.fields.tick_current_index.fields.bits.toString()})
        return {
            address, liquidity, current_tick_index, sqrt_price
        }
    }
}

interface TurbosBasicPoolInfo {
    coin_a: string // balance
    coin_b: string // balance
    coin_a_liquidity_usd: number,
    coin_b_liquidity_usd: number,
    coin_type_a: string,
    coin_type_b: string,
    fee: string, // in 100 * bps
    fee_type: string, // turbos pools have this as additional type,  
    type: string, // full type of pool with type arguments
    pool_id: string, // address
    liquidity: string, // check != 0
    tick_spacing: string,
    sqrt_price: string,
    tick_current_index: number,
    volume_24h_usd: number,
    volume_7d_usd: number
}

// https://api.turbos.finance/pools/v2?page=${page}&pageSize=100&orderBy=liquidity&category=&symbol=&includeRisk=true
interface TurbosApiPoolsResponse {
    list: TurbosBasicPoolInfo[],
    total: number,
}

interface TurbosTick {
    id: string, // tick address
    index: number, 
    initialized: boolean,
    // the remaining attributes are ="0" if tick not initialized 
    liquidity_net: string,
    liquidity_gross: string,
    fee_growth_outside_a: string,
    fee_growth_outside_b: string,
}