import { Dex } from "../src/defs/pools";
import { ConfigManagerBluefin, PoolManagerBluefin } from "../src/dexes/bluefin/pool_manager";

const example_config_bluefin: ConfigManagerBluefin = {
    dex: Dex.Bluefin,
    bluefin_api_wait_ms: 3 * 1000,
    threshold_liquidity_usd_for_pool: 40000,
    update_liquidity_ms: 60 * 1000,
    debug: true,
    propose_pools_timer_ms: 600 * 1000,
    static_upgrade_timer_ms: 600 * 1000, // plays no role
    static_upgrade_wait_time_ms: 600 * 1000, // plays no role 
    dynamic_upgrade_timer_ms: 10 * 1000,
    dynamic_upgrade_wait_time_ms: 10 * 1000,
    pools_per_sui_liquidity_fetch_call: 3,
    sui_rpc_wait_time_ms: 2 * 1000,
    sui_simulation_address: "0xaed3970cd36bbd3a8d7deb0d06acb27d3ff69cc4fd4657cea3b8adfacebcd3c4",
    tick_window_size: 30,
    collector_delivery_every_ms: 1000,
    collector_url: "http://localhost:7001/delivery",
    server_port: 6003 
}

const pool_manager = new PoolManagerBluefin(example_config_bluefin);

pool_manager.run();