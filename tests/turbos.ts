import { Dex } from "../src/defs/pools";
import { ConfigManagerTurbos, PoolManagerTurbos } from "../src/dexes/turbos/pool_manager";

const example_config_turbos: ConfigManagerTurbos = {
    dex: Dex.Turbos,
    turbos_api_wait_ms: 2 * 1000,
    threshold_pool_propose_liquidity_usd_each_coin: 20000,
    update_liquidity_ms: 60 * 1000,
    debug: true,
    propose_pools_timer_ms: 600 * 1000,
    static_upgrade_timer_ms: 600 * 1000, // plays no role
    static_upgrade_wait_time_ms: 600 * 1000, // plays no role 
    dynamic_upgrade_timer_ms: 10 * 1000,
    dynamic_upgrade_wait_time_ms: 360 * 1000,
    collector_delivery_every_ms: 1000,
    collector_url: "http://localhost:7001/delivery",
    server_port: 6004 
}

const pool_manager = new PoolManagerTurbos(example_config_turbos);

pool_manager.run();