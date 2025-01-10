import { Dex, Pool, check_pool, add_workflow_elements, update_coin_decimals_per_pool, check_static, check_dynamic } from "./pools"
import { logger, LogLevel, LogTopic } from "./logging"

interface ConfigManager {
    dex: Dex,
    debug: boolean,
    static_upgrade_wait_time_ms: number,
    dynamic_upgrade_wait_time_ms: number
}

export class PoolManager {
    config: ConfigManager;
    pools: Pool[];

    constructor(config: ConfigManager) {
        this.config = config
        this.pools = []
    }

    add(pools: Pool[]) {
        for (const pool of pools) {
            if (check_pool(pool) && pool.dex == this.config.dex  && ! this.pools.map((pool) => pool.address).includes(pool.address)){
                add_workflow_elements(pool);
                this.pools.push(pool);       
            }
            else {
                logger(this.config.debug, LogLevel.DEBUG, LogTopic.ADD_POOL, `${pool.address} Failed to add`)
            }
        }
    }

    remove(address: string) {
        this.pools = this.pools.filter((pool) => pool.address != address)
        logger(this.config.debug, LogLevel.DEBUG, LogTopic.REMOVE_POOL, `${address} removed`)
    }

    update_coin_decimals(coins_decimals: {[coin_type: string]: number}) {
        for (const pool of this.pools) {
            try {
                update_coin_decimals_per_pool(pool, coins_decimals)
            }
            catch (error) {
                logger(this.config.debug, LogLevel.ERROR, LogTopic.COIN_DECIMALS_UPDATE, `${pool.address} ${(error as Error).message}`)
            }
        }
    }

    update_tvl(coins_prices: {[coin_type: string]: number}) {
        for (const pool of this.pools) {
            try {
                if (pool.balances !== undefined && pool.coin_decimals !== undefined && pool.coin_types !== undefined) {
                    const coin_prices = pool.coin_types.map((t) => coins_prices[t]);
                    if (coin_prices.filter((price) => price == undefined).length == 0) {
                        const tvl = pool.coin_types!.map((t, i) => (Number(pool.balances![i])/10**pool.coin_decimals![i]) * coins_prices[t]).reduce((p, c) => p+c, 0)
                        pool.tvl = tvl    
                    }
                }    
            }
            catch (error) {
                logger(this.config.debug, LogLevel.ERROR, LogTopic.TVL_UPDATE, `${pool.address} ${(error as Error).message}`)
            }
        }
    }

    async propose_pools(): Promise<Pool[]> {
        throw new Error("Implement for each dex!")
    }

    async update_static() {
        const now = Date.now();
        const non_static_pools = this.pools.filter((pool) => {
            return !check_static(pool) && (now - pool.last_static_update!.time_ms) >= this.config.static_upgrade_wait_time_ms;
        });
        if (non_static_pools.length > 0) {
            try {
                non_static_pools.forEach(
                    (pool) => {
                        pool.last_static_update = {...pool.last_static_update!, time_ms: now, success: false}
                    }
                )
                const status = await this.upgrade_to_static(non_static_pools);
                status.forEach((value, i) => non_static_pools[i].last_static_update!.success = value);
            }
            catch (error) {
                logger(this.config.debug, LogLevel.ERROR, LogTopic.STATIC_UPDATE, (error as Error).message)
            }
        }
    }

    // Returns the success value for each pool
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async upgrade_to_static(pools: Pool[]) : Promise<boolean[]> {
        throw new Error("Implement for each dex!")
    }

    async update_dynamic() {
        const now = Date.now();
        const non_dynamic_pools = this.pools.filter((pool) => !check_dynamic(pool) && (now - pool.last_dynamic_upgrade!.time_ms) > this.config.dynamic_upgrade_wait_time_ms);
        try {
            non_dynamic_pools.forEach(
                (pool) => {
                    pool.last_dynamic_upgrade = {...pool.last_dynamic_upgrade!, time_ms: now, success: false}
                }
            )
            const status = await this.upgrade_to_dynamic(non_dynamic_pools);
            status.forEach((value, i) => {
                non_dynamic_pools[i].last_dynamic_upgrade!.success = value;
                if (value) {
                    non_dynamic_pools[i].last_pull_ms = {time_ms: Date.now(), success: true, counter: 0};
                } 
            });
        }
        catch (error) {
            logger(this.config.debug, LogLevel.ERROR, LogTopic.DYNAMIC_UPDATE, (error as Error).message)
        }
    }

    // Returns the success value for each pool
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async upgrade_to_dynamic(pools: Pool[]) : Promise<boolean[]> {
        throw new Error("Implement for each dex!")
    }

    filter_update(): Pool[] {
        throw new Error("Implement for each dex!")
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async update(pools: Pool[]) {
        throw new Error("Implement for each dex!")
    }

    async run() {
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const new_pools = await this.propose_pools();
            this.add(new_pools);
            await this.update_static();
            await this.update_dynamic();
            await this.update(this.pools.filter((pool) => check_dynamic(pool)));
        }
    }
}