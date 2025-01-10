import { PoolManager, ConfigManager } from "../../defs/pool_manager";
import { Dex } from "../../defs/pools";

export interface ConfigManagerTurbos extends ConfigManager {
    dex: Dex.Turbos,
    turbos_api_wait_ms: number,
    threshold_pool_propose_liquidity_usd_each_coin: number,
}

export class PoolManagerTurbos extends PoolManager {
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
        const page: number = 0;
        const pools: TurbosBasicPoolInfo[] = [];

        while (stop_requesting_pages) {
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
                const new_pools = response.list.filter(condition_for_pool);
                if (new_pools.length == 0) {stop_requesting_pages = true;}
                else {
                    new_pools.forEach((pool) => pools.push(pool));
                }
            }
        }
        
        return pools;
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