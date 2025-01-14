import { Dex, Pool, check_pool, add_workflow_elements, update_coin_decimals_per_pool, check_static, check_dynamic } from "./pools"
import { logger, LogLevel, LogTopic } from "./logging"
import { getFullnodeUrl, SuiClient } from '@mysten/sui/client'
//import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Transaction } from '@mysten/sui/transactions'
import { sleep, wait_for_call } from "../utils"
//import { fromBase64 } from '@mysten/sui/utils'
//import * as Fs from 'fs';

export interface ConfigManager {
    dex: Dex,
    debug: boolean,
    propose_pools_timer_ms: number,
    static_upgrade_wait_time_ms: number,
    static_upgrade_timer_ms: number
    dynamic_upgrade_wait_time_ms: number,
    dynamic_upgrade_timer_ms: number
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
                logger(this.config.debug, LogLevel.WORKFLOW, LogTopic.ADD_POOL, `${pool.address} proposed`)     
            }
            else {
                if (!this.pools.map((pool) => pool.address).includes(pool.address)) {
                    logger(this.config.debug, LogLevel.DEBUG, LogTopic.ADD_POOL, `${pool.address} Failed to add to list of pools`)
                }
            }
        }
    }

    remove(address: string) {
        this.pools = this.pools.filter((pool) => pool.address != address)
        logger(this.config.debug, LogLevel.WORKFLOW, LogTopic.REMOVE_POOL, `${address}`)
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
                if (pool.stats_balances !== undefined && pool.coin_decimals !== undefined && pool.coin_types !== undefined) {
                    const coin_prices = pool.coin_types.map((t) => coins_prices[t]);
                    if (coin_prices.filter((price) => price == undefined).length == 0) {
                        const tvl = pool.coin_types!.map((t, i) => (Number(pool.stats_balances![i])/10**pool.coin_decimals![i]) * coins_prices[t]).reduce((p, c) => p+c, 0)
                        pool.tvl = tvl    
                    }
                }    
            }
            catch (error) {
                logger(this.config.debug, LogLevel.ERROR, LogTopic.TVL_UPDATE, `${pool.address} ${(error as Error).message}`)
            }
        }
    }

    async propose_pools_and_add() {
        // eslint-disable-next-line no-constant-condition
        while (true) {
            logger(this.config.debug, LogLevel.WORKFLOW, LogTopic.PROPOSE_POOLS, "START")
            try {
                const new_pools = await this.propose_pools();
                this.add(new_pools);    
            }
            catch (error) {
                logger(this.config.debug, LogLevel.ERROR, LogTopic.PROPOSE_POOLS, (error as Error).message);
            }
            logger(this.config.debug, LogLevel.WORKFLOW, LogTopic.PROPOSE_POOLS, "END")
            await sleep(this.config.static_upgrade_timer_ms);
        }
    }

    async propose_pools(): Promise<Pool[]> {
        throw new Error("Implement for each dex!")
    }

    async update_static() {
        // eslint-disable-next-line no-constant-condition
        while (true) {
            try {
                const now = Date.now();
                const non_static_pools = this.pools.filter((pool) => {
                    return !check_static(pool) && (now - pool.last_static_update!.time_ms) >= this.config.static_upgrade_wait_time_ms;
                });
                if (non_static_pools.length > 0) {
                
                    non_static_pools.forEach(
                        (pool) => {
                            pool.last_static_update = {...pool.last_static_update!, time_ms: now, success: false}
                        }
                    )
                    const status = await this.upgrade_to_static(non_static_pools);
                    status.forEach((value, i) => non_static_pools[i].last_static_update!.success = value);
                }
            }
            catch (error) {
                logger(this.config.debug, LogLevel.ERROR, LogTopic.STATIC_UPDATE, (error as Error).message)
            }
            await sleep(this.config.static_upgrade_timer_ms)
        }
    }

    // Returns the success value for each pool
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async upgrade_to_static(pools: Pool[]) : Promise<boolean[]> {
        throw new Error("Implement for each dex!")
    }

    async update_dynamic() {
        // eslint-disable-next-line no-constant-condition
        while (true) {
            try {
                const now = Date.now();
                const non_dynamic_pools = this.pools.filter((pool) =>  check_static(pool) && !check_dynamic(pool) && (now - pool.last_dynamic_upgrade!.time_ms) > this.config.dynamic_upgrade_wait_time_ms);
                
                if (non_dynamic_pools.length > 0){
                    const status = await this.upgrade_to_dynamic(non_dynamic_pools);
                    status.forEach((value, i) => {
                        non_dynamic_pools[i].last_dynamic_upgrade!.success = value;
                        if (value) {
                            non_dynamic_pools[i].last_dynamic_upgrade = {time_ms: Date.now(), success: true, counter: non_dynamic_pools[i].last_dynamic_upgrade!.counter};
                            logger(this.config.debug, LogLevel.WORKFLOW, LogTopic.ADD_POOL, `${non_dynamic_pools[i].address} liquidity initialized`); 
                        } 
                        else {
                            non_dynamic_pools[i].last_dynamic_upgrade = {time_ms: Date.now(), success: false, counter: non_dynamic_pools[i].last_dynamic_upgrade!.counter + 1};
                            logger(this.config.debug, LogLevel.ERROR, LogTopic.ADD_POOL, `${non_dynamic_pools[i].address} liquidity initialization failed`);
                        }
                    });
                }
            }
            catch (error) {
                logger(this.config.debug, LogLevel.ERROR, LogTopic.DYNAMIC_UPDATE, (error as Error).message)
            }
            await sleep(this.config.dynamic_upgrade_timer_ms);
        }
    }

    // Returns the success value for each pool
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async upgrade_to_dynamic(pools: Pool[]) : Promise<boolean[]> {
        throw new Error("Implement for each dex!")
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async update() {
        throw new Error("Implement for each dex!")
    }

    async run() {
        this.propose_pools_and_add().catch((error) => {logger(this.config.debug, LogLevel.CRITICAL, LogTopic.PROPOSE_POOLS_STOPPED, (error as Error).message);});
        this.update_static().catch((error) => {logger(this.config.debug, LogLevel.CRITICAL, LogTopic.UPDATER_STATIC_STOPPED, (error as Error).message);});
        this.update_dynamic().catch((error) => {logger(this.config.debug, LogLevel.CRITICAL, LogTopic.UPDATER_DYNAMIC_STOPPED, (error as Error).message);});
        this.update().catch((error) => {logger(this.config.debug, LogLevel.CRITICAL, LogTopic.UPDATER_STOPPED, (error as Error).message);});
    }
}


export interface ConfigManagerWithClient extends ConfigManager{
    sui_rpc_wait_time_ms: number,
    sui_simulation_address: string
}

export class PoolManagerWithClient extends PoolManager {
    config: ConfigManagerWithClient
    client: SuiClient
    address: string
    last_sui_rpc_request_ms: number

    constructor(config: ConfigManagerWithClient) {
        super(config);
        this.config = config;
        this.client = new SuiClient({ url: getFullnodeUrl("mainnet")});
        this.last_sui_rpc_request_ms = 0;
        this.address = config.sui_simulation_address;
    }

    async simulateTransaction(tx: Transaction) {
        await wait_for_call(this.last_sui_rpc_request_ms, this.config.sui_rpc_wait_time_ms);
        tx.setSenderIfNotSet(this.address)
        logger(this.config.debug, LogLevel.WORKFLOW, LogTopic.SUI_CLIENT, "Call tx.build")
        const serialize = await tx.build({
            client: this.client
          })
        const start = Date.now()/1000;
        logger(this.config.debug, LogLevel.WORKFLOW, LogTopic.SUI_CLIENT, "Call dryRunTransactionBlock")
        const transactionResponse = await this.client.dryRunTransactionBlock({transactionBlock: serialize})
        logger(this.config.debug, LogLevel.WORKFLOW, LogTopic.SUI_CLIENT, `Call dryRunTransactionBlock took ${Date.now()/1000 - start} secs`);
        this.last_sui_rpc_request_ms = Date.now();
        return {receipt: {digest: ""}, transactionResponse}
    }

}