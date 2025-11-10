import { ConfigManagerWithClient } from "../src/defs/pool_manager";
import { Dex } from "../src/defs/pools";
import { PoolManagerSuilend } from "../src/dexes/suilend/pool_manager";

const example_config_aftermath: ConfigManagerWithClient = {
    dex: Dex.Suilend,
    debug: true,
    propose_pools_timer_ms: 6000 * 1000,
    static_upgrade_timer_ms: 600 * 1000, // plays no role
    static_upgrade_wait_time_ms: 600 * 1000, // plays no role 
    dynamic_upgrade_timer_ms: 10 * 1000,
    dynamic_upgrade_wait_time_ms: 10 * 1000,
    sui_rpc_wait_time_ms: 2 * 1000,
    sui_simulation_address: "0xaed3970cd36bbd3a8d7deb0d06acb27d3ff69cc4fd4657cea3b8adfacebcd3c4",
    collector_delivery_every_ms: 1000,
    collector_url: "http://localhost:7001/delivery",
    server_port: 6008 
}

const pool_manager = new PoolManagerSuilend(example_config_aftermath);

pool_manager.run();