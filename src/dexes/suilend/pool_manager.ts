import { logger, LogLevel, LogTopic } from "../../defs/logging";
import { PoolManagerWithClient, ConfigManagerWithClient  } from "../../defs/pool_manager";
import { Dex, Model, Pool } from "../../defs/pools";
import { token_info, vault_config } from "./config";


export class PoolManagerSuilend extends PoolManagerWithClient {
    
    config: ConfigManagerWithClient
    constructor(config: ConfigManagerWithClient) {
        if (config.dex != Dex.Suilend) throw new Error(`${Dex.Suilend} manager called with ${config.dex} dex argument`)
        super(config);
        this.config = config;
    }

    async propose_pools(): Promise<Pool[]> {
        const pools_proposed: Pool[] = [];
        
        for (const id in vault_config) {
            const conf = vault_config[id];
            const coin_types = [token_info[conf.deposit_token].type, token_info[conf.debt_token].type];
            const fee = Math.floor(Number(conf.fee)/2**64 * 10000 * 100)
            const pool: Pool = {
                address: id,
                dex: this.config.dex,
                model: Model.Amm,
                coin_types,
                static_fee: fee,
                pool_call_types: []
            }   
            pools_proposed.push(pool);
        }

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


