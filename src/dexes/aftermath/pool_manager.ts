import { logger, LogLevel, LogTopic } from "../../defs/logging";
import { PoolManagerWithClient, ConfigManagerWithClient  } from "../../defs/pool_manager";
import { Dex, Model, Pool } from "../../defs/pools";
import { sleep} from "../../utils";


export interface ConfigManagerAftermath extends ConfigManagerWithClient {
    dex: Dex.Aftermath,
    aftermath_api_wait_ms: number,
    threshold_liquidity_usd_for_pool: number,
}

export class PoolManagerAftermath extends PoolManagerWithClient {
    last_call_aftermath_api: number
    config: ConfigManagerAftermath
    constructor(config: ConfigManagerAftermath) {
        if (config.dex != Dex.Aftermath) throw new Error(`${Dex.Aftermath} manager called with ${config.dex} dex argument`)
        super(config);
        this.config = config;
        this.last_call_aftermath_api = 0;
    }

    async call_aftermath_pool_api(condition_for_pool: (pool_info: AftermathBasicPoolInfo) => boolean): Promise<AftermathBasicPoolInfo[]> {

        const pools: AftermathBasicPoolInfo[] = [];

        if (Date.now()-this.last_call_aftermath_api > this.config.aftermath_api_wait_ms) {
            try {
                const response: AftermathBasicPoolInfo[] = await (await fetch("https://aftermath.finance/api/pools/", {
                    "headers": {
                        "content-type": "text/plain",
                    },
                    "body": null,
                    "method": "GET"
                    })
                ).json();
                
                let i=0;
                while (i < response.length){
                    const pool_ids = {poolIds: response.slice(i, i+100).map((x)=> x.objectId)};
                    const stats: AftermathPoolStats[] = await ( await 
                        fetch("https://aftermath.finance/api/pools/stats", {
                            "headers": {
                                "accept": "*/*",
                                
                            },
                            "body": JSON.stringify(pool_ids),
                            "method": "POST"
                            })).json();
                    i = i + 100;
                    pool_ids.poolIds.forEach((address, j) => {
                        const pool = response.filter((p) => p.objectId == address)[0];
                        pool.stats = stats[j];
                    });
                    sleep(1000);
                }
                this.last_call_aftermath_api = Date.now();

                const new_pools = response.filter(condition_for_pool);
                new_pools.forEach((pool) => pools.push(pool));
            }
            catch (error) {
                logger(this.config.debug, LogLevel.ERROR, LogTopic.PROPOSE_POOLS, `Aftermath API call failed: ${(error as Error).message}`)
            }
        }    
        return pools;
    }

    condition_for_pool(pool_info: AftermathBasicPoolInfo): boolean {
        if (pool_info.stats) {
            return Number(pool_info.stats.tvl) > this.config.threshold_liquidity_usd_for_pool
        }
        else return false;
    }

    parse_basic_pool_info(pool_info: AftermathBasicPoolInfo): Pool {
        const coins = pool_info.coins; 
        const coin_infos: AftermathCoinInfo[] = [];
        
        for (const coin_type in coins) {
            const coin_info = coins[coin_type];
            coin_info.type = coin_type;
            coin_infos.push(coin_info);
        }
        const weights = coin_infos.map((c) => c.weight).map((weight) => Number(weight.slice(0, 3))/1000)
        // TODO: check fees
        const fees = coin_infos.map((c)=>c.tradeFeeIn).map((fee) => 100 * Number(fee.replace("n", ""))/100000000000000)
        if (fees.some((fee) => fee != fees[0])) throw new Error("Undetermined total fee")

        if (pool_info.flatness != "0n") {
            if (weights.some((p) => Math.abs(p - weights[0]) > 0.01)) {
                logger(this.config.debug, LogLevel.DEBUG, LogTopic.ADD_POOL, `${pool_info.objectId} Aftermath stable pool with different weights!`);    
            }
        }
        if (coin_infos.filter((c)=> c.tradeFeeOut != "0n").length > 0) {
            logger(this.config.debug, LogLevel.DEBUG, LogTopic.ADD_POOL, `${pool_info.objectId} Aftermath pool with fee out!`);    
        }

        const model = pool_info.flatness == "0n" ? (weights.some((p) => p != 0.5) ? Model.Balancer : Model.Amm) : Model.AftermathStable;

        const pool: Pool = {
            address: pool_info.objectId, 
            dex: this.config.dex, 
            model: model, 
            coin_types: Object.keys(coins),
            pool_call_types: [pool_info.lpCoinType],
            stable_amplification: Number(pool_info.flatness.replace("n", ""))/(10**18),
            weights,
            static_fee: fees[0],
        };
        
        return pool;
    }

    async propose_pools(): Promise<Pool[]> {
        const response = await this.call_aftermath_pool_api((pool_info) => this.condition_for_pool(pool_info));
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

    async update_liquidity(pools: Pool[]): Promise<boolean> { 
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
        // nothing to do here 
        const status: boolean[] = [];

        const success_liquidity_update = await this.update_liquidity(pools); 
        if (success_liquidity_update) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            pools.forEach((_) => {
                status.push(success_liquidity_update)
            })
        }
        return status;
    } 

    async update(): Promise<void> {
        // nothing to do here 
    }
}

interface AftermathCoinInfo  {
    type?: string,
    "weight": string, // e.g. "500000000000000000n"
    "balance": string, //e.g. "16090948578616763n"
    "tradeFeeIn": string, //e.g.  "10000000000000000n" 
    "tradeFeeOut": string, //e.g. "0n"
    "depositFee": string,
    "withdrawFee": string,
    "normalizedBalance": string, //e.g. "16090948578616763000000000000000000n"
    "decimalsScalar": string, //e.g. "1000000000000000000n"
    "decimals": number
}

interface AftermathBasicPoolInfo {
    "objectType": string, //
    "lpCoinType": string, // lp type, type aregument for pool calls
    "coins": {
        [coin_type: string]: AftermathCoinInfo
    },
    "objectId": string, // address
    "name": string,
    "lpCoinSupply": string, //e.g. "1000n"
    "illiquidLpCoinSupply": string, //e.g. "1000n"
    "flatness": string, //e.g. "0n"
    "lpCoinDecimals": number,
    stats?: AftermathPoolStats
}

interface AftermathPoolStats {
    volume: number,
    tvl: number,
    supplyPerLps: number[],
    lpPrice: number,
    fees: number,
    apr: number
}
