import { Dex, Pool, check_pool, add_workflow_elements, update_coin_decimals_per_pool, check_static, check_dynamic, to_essential_json, Model } from "./pools"
import { logger, LogLevel, LogTopic } from "./logging"
import { sleep, wait_for_call } from "../utils"

// external
import * as http from 'http';
import { getFullnodeUrl, SuiClient, SuiObjectResponse } from '@mysten/sui/client'
import { Transaction } from '@mysten/sui/transactions'

export interface ConfigManager {
    dex: Dex,
    debug: boolean,
    propose_pools_timer_ms: number,
    static_upgrade_wait_time_ms: number,
    static_upgrade_timer_ms: number
    dynamic_upgrade_wait_time_ms: number,
    dynamic_upgrade_timer_ms: number,
    collector_url?: string,
    collector_delivery_every_ms: number,
    server_port?: number
}

export class PoolManager {
    config: ConfigManager;
    pools: Pool[];
    state_delivery: {data: string, timestamp: number, dex: Dex}
    status_delivery: boolean;

    constructor(config: ConfigManager) {
        this.config = config
        this.pools = []
        this.status_delivery = true
        this.state_delivery = {data: JSON.stringify(this.pools), timestamp: Date.now(), dex: config.dex}
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

    create_server(): http.Server {
        const server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
            const { method } = req;
    
            try {
                if (method === 'GET') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(this.state_delivery));
                } else {
                    throw new Error(`Request method ${method} not supported`);
                }
            } catch (error) {
                this.handleError(res, error);
            }
        });
    
        return server;
    }
    
    private handleError(res: http.ServerResponse, error: unknown): void {
        const errorMessage = (error instanceof Error) ? error.message : 'Unknown error';
        logger(this.config.debug, LogLevel.ERROR, LogTopic.SERVER_REQUEST, errorMessage);
    
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server Error');
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

    async update_state_and_deliver() {
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const complete_pools = this.pools.filter((pool)=> check_dynamic(pool) && this.test_liquidity_passed(pool));
            const state = JSON.stringify(complete_pools.map((pool) => to_essential_json(pool)))
            if (state != this.state_delivery.data) {
                this.state_delivery = {
                    data: state,
                    timestamp: Date.now(),
                    dex: this.config.dex
                }
                this.status_delivery = false
            }
            if (!this.status_delivery) {
                try {
                    if (this.config.collector_url !== undefined && this.config.collector_url !== "") {
                        const request = await 
                            fetch(this.config.collector_url, {
                                "headers": {
                                    "accept": "*/*",
                                },
                                "body": JSON.stringify(this.state_delivery),
                                "method": "POST"
                            })
                        if (request.status == 200) {
                            this.status_delivery = true
                            logger(this.config.debug, LogLevel.WORKFLOW, LogTopic.COLLECTOR_DELIVERY, "successful");
                        } 
                        else {
                            this.status_delivery = false
                            logger(this.config.debug, LogLevel.WORKFLOW, LogTopic.COLLECTOR_DELIVERY, `${request.status} ${request.statusText}`);
                        }
                    }
                }
                catch (error) {
                    logger(this.config.debug, LogLevel.ERROR, LogTopic.COLLECTOR_DELIVERY, `${(error as Error).message}`);
                } 
            }
            await sleep(this.config.collector_delivery_every_ms);
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    test_liquidity_passed(pool: Pool): boolean {
       return true // implement in class extensions
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

}


export interface ConfigManagerWithClient extends ConfigManager{
    sui_rpc_wait_time_ms: number,
    sui_simulation_address: string,
    liquidity_test_every_ms?: number,
    limit_objects_pre_sui_call?: number,
    test_liquidity_limit_failed?: number 
}

export class PoolManagerWithClient extends PoolManager {
    config: ConfigManagerWithClient
    client: SuiClient
    address: string
    last_sui_rpc_request_ms: number
    failed_test_pools: {address: string, counter: number, test_name: TestNames}[]

    constructor(config: ConfigManagerWithClient) {
        super(config);
        this.config = config;
        this.client = new SuiClient({ url: getFullnodeUrl("mainnet")});
        this.last_sui_rpc_request_ms = 0;
        this.address = config.sui_simulation_address;
        if (this.config.limit_objects_pre_sui_call === undefined) {
            this.config.limit_objects_pre_sui_call = 30;
        }
        if (this.config.test_liquidity_limit_failed === undefined) {
            this.config.test_liquidity_limit_failed = 10
        }
        this.failed_test_pools = [];
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

    async test_liquidity() { 
        const in_scope = this.pools.filter((p) => check_dynamic(p) && p.model == Model.UniswapV3);
        
        // remove removed pools
        this.failed_test_pools = this.failed_test_pools.filter((p) => in_scope.find((pool) => pool.address == p.address) !== undefined);

        const l = in_scope.length; 
        if (l>0) {
            // always add the failed pools
            const test_indices = this.failed_test_pools.filter((p) => p.test_name == TestNames.LIQUIDITY).map((p) => in_scope.findIndex((pool) => pool.address == p.address));

            if (test_indices.length >= this.config.limit_objects_pre_sui_call!) {
                logger(this.config.debug, LogLevel.ERROR, LogTopic.TEST_LIQUIDITY, "All test spots taken by failed pools");
            }

            while (test_indices.length < Math.min(this.config.limit_objects_pre_sui_call!, l)) {
                const j = Math.floor(Math.random() * l)
                if (!test_indices.includes(j)) {
                    test_indices.push(j)
                }
            }
            try {
                const test_pools_liquidity = test_indices.map((i) => {return {
                    address: in_scope[i].address, 
                    liquidity: in_scope[i].liquidity!,
                    tick_spacing: in_scope[i].tick_spacing!
                }});

                // fetch objects
                await wait_for_call(this.last_sui_rpc_request_ms, this.config.sui_rpc_wait_time_ms);
                const sui_objects = await this.client.multiGetObjects({ids: test_pools_liquidity.map((p) => p.address), options: {"showContent": true}})
                this.last_sui_rpc_request_ms = Date.now();

                logger(this.config.debug, LogLevel.DEBUG, LogTopic.TEST_LIQUIDITY, `Testing ${test_pools_liquidity.length} pools including ${this.failed_test_pools.filter((p) => p.test_name == TestNames.LIQUIDITY).length} previously failed pools`);

                test_pools_liquidity.forEach((p, i) => {
                    const object_info = this.parse_object(sui_objects[i]);
                    const predicted_liquidity_below = p.liquidity.filter((t) => t.tick_index <= object_info.current_tick_index).reduce((p, c) => p + c.liquidity_net, BigInt(0))
                    const predicted_liquidity_above = - p.liquidity.filter((t) => t.tick_index > object_info.current_tick_index).reduce((p, c) => p + c.liquidity_net, BigInt(0))
                    if (predicted_liquidity_below != object_info.liquidity || predicted_liquidity_above != object_info.liquidity) {
                        if (object_info.liquidity == BigInt(0)) {
                            logger(this.config.debug, LogLevel.DEBUG, LogTopic.FAILED_TEST_LIQUIDITY, `${p.address} predicted: ${predicted_liquidity_above} / ${predicted_liquidity_below} object: 0`) 
                            this.add_test_failure(p.address, TestNames.LIQUIDITY);
                        }
                        else {
                            const in_percent = Math.max(Math.abs((1 - Number(predicted_liquidity_above)/Number(object_info.liquidity)) * 100), Math.abs((1 - Number(predicted_liquidity_below)/Number(object_info.liquidity)) * 100)) 
                            logger(this.config.debug, LogLevel.DEBUG, LogTopic.FAILED_TEST_LIQUIDITY, `${p.address} predicted: ${predicted_liquidity_above} / ${predicted_liquidity_below} object: ${object_info.liquidity} diff in perc: ${in_percent}`)    
                            
                            if (in_percent > 0.00001) {
                                this.add_test_failure(p.address, TestNames.LIQUIDITY);
                            }   
                            else {
                                this.remove_test_failure(p.address, TestNames.LIQUIDITY)
                            }
                        }
                    }
                    else {
                        this.remove_test_failure(p.address, TestNames.LIQUIDITY)
                    }
                })            
            }
            catch (error) {
                logger(this.config.debug, LogLevel.ERROR, LogTopic.TEST_LIQUIDITY, `${(error as Error).message}`)
            }    
        }
    }

    add_test_failure(address: string, test_name: TestNames) {
        const element = this.failed_test_pools.find((failed_pool) => failed_pool.address == address && failed_pool.test_name == test_name);
        if (element){
            element.counter = element.counter + 1
            logger(this.config.debug, LogLevel.DEBUG, LogTopic.FAILED_TEST_LIQUIDITY, `${address} liquidity test failed for ${element.counter} times`)    
        }
        else {
            this.failed_test_pools.push({address, counter: 1, test_name});
        }
    }

    remove_test_failure(address: string, test_name: TestNames) {
        this.failed_test_pools = this.failed_test_pools.filter((failed) => !(failed.address == address && failed.test_name==test_name))
    }

    test_liquidity_passed(pool: Pool): boolean {
        const query = this.failed_test_pools.find((p) => (p.address == pool.address) && (p.test_name == TestNames.LIQUIDITY));
        if (query === undefined) {
            return true
        }
        else {
            return query!.counter < this.config.test_liquidity_limit_failed! 
        }
    }

    async test_liquidity_loop() {
        if (this.config.liquidity_test_every_ms) {
            let last_test: number = Date.now();
            // eslint-disable-next-line no-constant-condition
            while (true) {
                if (Date.now() - last_test > this.config.liquidity_test_every_ms) {
                    await this.test_liquidity();
                    last_test = Date.now();
                }
                await sleep(this.config.liquidity_test_every_ms);
            } 
        }
        else {
            logger(this.config.debug, LogLevel.WORKFLOW, LogTopic.TEST_LIQUIDITY, "No tests scheduled")
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    parse_object(sui_object: SuiObjectResponse): ParsedSuiObjectInfo {
        throw new Error("Implement for each dex!")
    }

    async run() {
        this.propose_pools_and_add().catch((error) => {logger(this.config.debug, LogLevel.CRITICAL, LogTopic.PROPOSE_POOLS_STOPPED, (error as Error).message);});
        this.update_static().catch((error) => {logger(this.config.debug, LogLevel.CRITICAL, LogTopic.UPDATER_STATIC_STOPPED, (error as Error).message);});
        this.update_dynamic().catch((error) => {logger(this.config.debug, LogLevel.CRITICAL, LogTopic.UPDATER_DYNAMIC_STOPPED, (error as Error).message);});
        this.update().catch((error) => {logger(this.config.debug, LogLevel.CRITICAL, LogTopic.UPDATER_STOPPED, (error as Error).message);});
        this.update_state_and_deliver().catch((error) => {logger(this.config.debug, LogLevel.CRITICAL, LogTopic.COLLECTOR_DELIVERY, (error as Error).message);});
        this.test_liquidity_loop();

        if (this.config.server_port) {
            const server = this.create_server();

            server.listen(this.config.server_port, () => {
                logger(this.config.debug, LogLevel.WORKFLOW, LogTopic.SERVER, 
                    `Server running at http://localhost:${this.config.server_port}/`);
            });
        
            server.on('error', (error: NodeJS.ErrnoException) => {
                logger(this.config.debug, LogLevel.CRITICAL, LogTopic.SERVER, 
                    `Server stopped. ${error.message}`);
            });
        }
    }

}

export interface ParsedSuiObjectInfo {
    address?: string,
    dex?: Dex,
    model?: Model,
    coin_types?: string[],
    pool_call_types?: string[],
    static_fee?: number // 100 * bps 
    weights?: number[], // balancer
    stable_amplification?: number,
    tick_spacing?: number,
    sqrt_price: bigint,
    current_tick_index: number,
    liquidity: bigint
}

enum TestNames {
    LIQUIDITY = "LIQUIDITY"
}