import { ConfigPriceManager, PriceManager } from "../src/defs/price_manager_objects";
//import { sleep } from "../src/utils";

const config: ConfigPriceManager = {
    debug: true,
    sui_rpc_wait_time_ms: 200,
    sui_rpc_wait_time_after_error_ms: 5000,
    collector_url: "http://localhost:7001/",
    fetch_price_every_ms: 5* 100,
    check_for_new_pools_every_ms: 60 * 1000
}

const price_manager = new PriceManager(config);

// async function run_test() {
//     price_manager.loop_fetch_new_pools().catch((error) => console.log(error));

//     await sleep(2 * 1000)
//     console.log(price_manager.prices)
//     await price_manager.get_prices();
//     console.log(price_manager.prices)
// }

// run_test();

price_manager.run();