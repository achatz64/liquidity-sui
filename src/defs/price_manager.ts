import { Dex, Model, Pool } from "./pools";
import { price_packages, timestamp_package } from "../config/packages";

// external
import { getFullnodeUrl, SuiClient } from '@mysten/sui/client'
import { Transaction } from '@mysten/sui/transactions'
import { sleep, wait_for_call } from "../utils";
import { logger, LogLevel, LogTopic } from "./logging";

export interface PriceInfo {
    address: string,
    dex: Dex,
    model: Model,
    pool_call_types: string[],

    sqrt_price?: bigint,
    balances?: bigint[]
}

export interface PriceDelivery {
    data: {[pool_address: string]: string|string[]}, 
    timestamp: number
}

export interface ConfigPriceManager {
    debug: boolean,
    sui_rpc_wait_time_ms: number,
    sui_rpc_wait_time_after_error_ms: number,
    sui_simulation_address: string,
    fetch_price_every_ms: number,
    check_for_new_pools_every_ms: number

    collector_url: string
}

export class PriceManager {
    config: ConfigPriceManager
    prices: {data: PriceInfo[], timestamp: number}
    client: SuiClient
    address: string
    last_sui_rpc_request_ms: number
    pools_updated: number = 0; // used for tx serialization
    last_serialization: number = -1;
    serialized_txn?: Uint8Array
    
    constructor(config: ConfigPriceManager) {
        this.config = config
        this.client = new SuiClient({url: getFullnodeUrl("mainnet")});
        this.last_sui_rpc_request_ms = 0;
        this.address = config.sui_simulation_address;
        this.prices = {data: [], timestamp: 0};
    }

    async retrieve_all_pools(): Promise<Pool[]> {
        const url = this.config.collector_url;
        const request: {[dex: string]: {data: string, timestamp: number}} = await (await fetch(url + "retrieval", {
            "headers": {
                "accept": "*/*",
            },
            "body": JSON.stringify({}),
            "method": "POST"
        })).json();

        const all_pools: Pool[] =[];
    
        for (const dex of Object.values(Dex)) {
            const dex_data = request[dex].data;
            const dex_pools: Pool[] = JSON.parse(dex_data);
            dex_pools.forEach((p) => all_pools.push(p));
        }

        return all_pools;
    }

    remove_pool(address: string) {
        this.prices = {data: this.prices.data.filter((pr) => pr.address != address), timestamp: this.prices.timestamp};
        this.pools_updated = Date.now();
        logger(this.config.debug, LogLevel.DEBUG, LogTopic.FETCH_POOLS, `Removing pool ${address}`)
    }

    add_pool(pool: Pool) {
        this.prices.data.push({
            address: pool.address,
            dex: pool.dex,
            model: pool.model!,
            pool_call_types: pool.pool_call_types!
        })
        this.pools_updated = Date.now();
        logger(this.config.debug, LogLevel.DEBUG, LogTopic.FETCH_POOLS, `Adding pool ${pool.address}`)
    }

    async loop_fetch_new_pools() {
        // eslint-disable-next-line no-constant-condition
        while (true){
            try {
                const all_pools = await this.retrieve_all_pools();
                const all_pools_addr = all_pools.map((pool) => pool.address);
    
                // remove if not used anymore
                const current_addr = this.prices.data.map((pr) => pr.address);
                current_addr.forEach((addr) => {
                    if (! all_pools_addr.some((a) => a == addr)) {
                        this.remove_pool(addr)
                    }
                })
    
                all_pools.forEach((pool) => {
                    if (! this.prices.data.some((pr) => pr.address == pool.address)) {
                        this.add_pool(pool);
                    }
                })

                logger(this.config.debug, LogLevel.DEBUG, LogTopic.FETCH_POOLS, "Updated pools")
            }
            catch (error) {
                logger(this.config.debug, LogLevel.ERROR, LogTopic.FETCH_POOLS, `${(error as Error).message}`);
            }
            await sleep(this.config.check_for_new_pools_every_ms);
        }
    } 

    handle_event(event_parsed_json: {data: {id: string, b?: string[], sp?: string}[]}) {
        const l = event_parsed_json.data
        l.forEach((entry) => {
            const to_modify = this.prices.data.find((v) => v.address == entry.id);
            if (to_modify) {
                if (entry.b !== undefined) {
                    to_modify.balances = entry.b!.map((s) => BigInt(s));
                }
                else if (entry.sp !== undefined) {
                    to_modify.sqrt_price = BigInt(entry.sp!);
                }
                else {
                    logger(this.config.debug, LogLevel.ERROR, LogTopic.FETCH_PRICE, `Failed to parse ${JSON.stringify(entry)}`)
                }
            }
            else {
                logger(this.config.debug, LogLevel.ERROR, LogTopic.FETCH_PRICE, `Cannot find pool ${entry.id}`)
            }
        })
    }

    read_time(event_parsed_json: {timestamp: string}) {
        return Number(event_parsed_json.timestamp)
    }

    construct_price_request(): Transaction {
        const tx = new Transaction();

        tx.moveCall({
            target: `${timestamp_package}::timestamp::emit_time_event`,
            arguments: [tx.object("0x0000000000000000000000000000000000000000000000000000000000000006")]
        })

        for (const dex of Object.values(Dex)) {
          this.add_dex_to_txn_sqrt_prices(dex, tx)
          this.add_dex_to_txn_balances(dex, tx)
        }

        return tx
    }

    add_dex_to_txn_balances(dex: Dex, txn: Transaction) {
        const scope = this.prices.data.filter((pr) => pr.dex == dex && pr.model != Model.UniswapV3);

        if (scope.length > 0) {
            const partition: number[] = [Math.floor(scope.length / 4)]
        
            let remainder = scope.length % 4;
            if (remainder >= 2) {
                partition.push(1)
                remainder = remainder - 2
            }
            else {
                partition.push(0)
            }
    
            if (remainder >= 1) {
                partition.push(1)
                remainder = remainder - 1
            }
            else {
                partition.push(0)
            }
    
            if (remainder != 0 || partition.length != 3) throw new Error("I can't do basic arithmetic no more")
            
            const package_id = price_packages[dex];
            const module = "balance"
    
            let start = 0
    
            for (let i=0; i<3; i++) {
                const count_batch = 2**(2-i)
                const number_iterations = partition[i]
    
                for (let j=0; j < number_iterations; j++) {
                    const corresponding_slice = scope.slice(start + j * count_batch, start + count_batch * (j+1));
                    const type_args: string[] = [];
                    corresponding_slice.forEach((pr) => {
                        pr.pool_call_types.forEach((t) => type_args.push(t))
                    })
    
                    const pools = corresponding_slice.map((pr) => txn.object(pr.address))
    
                    const b = txn.moveCall({
                        target: `${package_id}::${module}::get_balances_${count_batch}`,
                        arguments: [...pools],
                        typeArguments: type_args
                    })
    
                    txn.moveCall({
                        target: `${package_id}::${module}::emit_balances`,
                        arguments: [b[0]]
                    })
                
                }
    
                start = start + number_iterations * count_batch;
            } 
        }
        
        return txn
    }

    add_dex_to_txn_sqrt_prices(dex: Dex, txn: Transaction){
        const scope = this.prices.data.filter((pr) => pr.dex == dex && pr.model == Model.UniswapV3);

        if (scope.length > 0) {       
            const partition: number[] = [Math.floor(scope.length / 4)]
        
            let remainder = scope.length % 4;
            if (remainder >= 2) {
                partition.push(1)
                remainder = remainder - 2
            }
            else {
                partition.push(0)
            }

            if (remainder >= 1) {
                partition.push(1)
                remainder = remainder - 1
            }
            else {
                partition.push(0)
            }

            if (remainder != 0 || partition.length != 3) throw new Error("I can't do basic arithmetic no more")
            
            const package_id = price_packages[dex];
            const module = "sqrtprice"

            let start = 0

            for (let i=0; i<3; i++) {
                const count_batch = 2**(2-i)
                const number_iterations = partition[i]

                for (let j=0; j < number_iterations; j++) {
                    const corresponding_slice = scope.slice(start + j * count_batch, start + count_batch * (j+1));
                    const type_args: string[] = [];
                    corresponding_slice.forEach((pr) => {
                        pr.pool_call_types.forEach((t) => type_args.push(t))
                    })

                    const pools = corresponding_slice.map((pr) => txn.object(pr.address))

                    const b = txn.moveCall({
                        target: `${package_id}::${module}::get_sqrtprice_${count_batch}`,
                        arguments: [...pools],
                        typeArguments: type_args
                    })

                    txn.moveCall({
                        target: `${package_id}::${module}::emit_sqrts`,
                        arguments: [b[0]]
                    })
                
                }

                start = start + number_iterations * count_batch;
            } 
        } 

        return txn
    }

    async get_prices() {
        try {
            if (this.pools_updated > this.last_serialization) {
                const make_copy = this.pools_updated;
                // serialize new txn
                const tx = this.construct_price_request();
                this.serialized_txn = await this.serializeTransaction(tx)
                this.last_serialization = make_copy;
            }
        
            const response = (await this.simulateTransaction()).transactionResponse;    
            const timestamp = this.read_time(response.events[0].parsedJson as {timestamp: string});
            const price_events = response.events.slice(1).map((e) => e.parsedJson as {data: {id: string, b?: string[], sp?: string}[]});
            price_events.forEach((e) => this.handle_event(e))
            this.prices.timestamp = timestamp;
            logger(this.config.debug, LogLevel.DEBUG, LogTopic.FETCH_PRICE, `Timestamp difference ${Date.now()-timestamp}`)
        }
        catch (error) {
            logger(this.config.debug, LogLevel.ERROR, LogTopic.FETCH_PRICE, `${(error as Error).message}`)
        }
    }

    async price_delivery_to_collector() {
        const url = this.config.collector_url;
        const data: {[pool_address: string]: string|string[]} = {}
        for (const pr of this.prices.data) {
            if (pr.balances != undefined || pr.sqrt_price != undefined) {
                data[pr.address] = pr.balances?.map((b)=>b.toString()) ?? pr.sqrt_price!.toString();
            }
        } 
        logger(this.config.debug, LogLevel.DEBUG, LogTopic.DELIVER_PRICE, `Found ${Object.keys(data).length} prices for  ${this.prices.data.length} pools.`)
        
        if (Object.keys(data).length > 0) {
            const send: PriceDelivery = {data, timestamp: this.prices.timestamp} 
            const body = JSON.stringify(send);
            const request = await fetch(url + "price_del", {
                "headers": {
                    "accept": "*/*",
                },
                body,
                "method": "POST"
            })
            
            if (request.status != 200) {
                logger(this.config.debug, LogLevel.ERROR, LogTopic.DELIVER_PRICE, `${request.statusText}`)
            }
        }
    }

    async serializeTransaction(tx: Transaction) {
        await wait_for_call(this.last_sui_rpc_request_ms, this.config.sui_rpc_wait_time_ms);
        tx.setSenderIfNotSet(this.address)
        logger(this.config.debug, LogLevel.WORKFLOW, LogTopic.SUI_CLIENT, "Call tx.build")
        const start_serialize = Date.now()/1000;
        const serialize = await tx.build({
            client: this.client
        })
        this.last_sui_rpc_request_ms = Date.now();
        logger(this.config.debug, LogLevel.WORKFLOW, LogTopic.SUI_CLIENT, `Call serialize took ${Date.now()/1000 - start_serialize} secs`);
        return serialize;
    }

    async simulateTransaction() {
        if (this.serialized_txn == undefined) throw new Error("No serialized txn available")
        await wait_for_call(this.last_sui_rpc_request_ms, this.config.sui_rpc_wait_time_ms);
        const start = Date.now()/1000;
        logger(this.config.debug, LogLevel.WORKFLOW, LogTopic.SUI_CLIENT, "Call dryRunTransactionBlock")
        const transactionResponse = await this.client.dryRunTransactionBlock({transactionBlock: this.serialized_txn})
        logger(this.config.debug, LogLevel.WORKFLOW, LogTopic.SUI_CLIENT, `Call dryRunTransactionBlock took ${Date.now()/1000 - start} secs`);
        this.last_sui_rpc_request_ms = Date.now();
        return {receipt: {digest: ""}, transactionResponse}
    }

    async loop_fetch_price() {
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const start = Date.now();
            try {
                await this.get_prices();
                await this.price_delivery_to_collector();
            }
            catch (error) {
                logger(this.config.debug, LogLevel.ERROR, LogTopic.FETCH_PRICE, `${(error as Error).message}`)
                await sleep(this.config.sui_rpc_wait_time_after_error_ms)
            }
            const diff = Date.now() - start;
            if (diff < this.config.fetch_price_every_ms) {
                await sleep(this.config.fetch_price_every_ms - diff);
            }
        }
    }

    async run() {
        this.loop_fetch_new_pools().catch((error)=> logger(this.config.debug, LogLevel.CRITICAL, LogTopic.LOOP_FETCH_POOLS, `${(error as Error).message}`))
        this.loop_fetch_price().catch((error)=> logger(this.config.debug, LogLevel.CRITICAL, LogTopic.LOOP_FETCH_PRICE, `${(error as Error).message}`))
    }
}
