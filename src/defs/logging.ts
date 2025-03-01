export enum LogLevel {
    ERROR = "ERROR",
    DEBUG = "DEBUG",
    CRITICAL = "CRITICAL",
    WORKFLOW = "WORKFLOW"
}

export enum LogTopic {
    // critical
    PROPOSE_POOLS_STOPPED = "PROPOSE_POOLS_STOPPED",
    UPDATER_STATIC_STOPPED = "UPDATER_STATIC_STOPPED",
    UPDATER_DYNAMIC_STOPPED = "UPDATER_DYNAMIC_STOPPED",
    UPDATER_STOPPED = "UPDATER_STOPPED",
    LOOP_FETCH_POOLS = "LOOP_FETCH_POOLS",
    LOOP_FETCH_PRICE = "LOOP_FETCH_PRICE",
   
    // else
    TVL_UPDATE = "TVL_UPDATE",
    COIN_DECIMALS_UPDATE = "COIN_DECIMALS_UPDATE",
    STATIC_UPDATE = "STATIC_UPDATE",
    DYNAMIC_UPDATE = "DYNAMIC_UPDATE",
    ADD_POOL = "ADD_POOL",
    REMOVE_POOL = "REMOVE_POOL",
    PROPOSE_POOLS = "PROPOSE_POOLS",
    FETCH_POOLS = "FETCH_POOLS",
    LIQUIDITY_UPDATE = "LIQUIDITY_UPDATE",
    SUI_CLIENT = "SUI_CLIENT",
    COLLECTOR_DELIVERY = "COLLECTOR_DELIVERY",
    SERVER = "SERVER",
    SERVER_REQUEST = "SERVER_REQUEST",
    FETCH_PRICE="FETCH_PRICE",
    FETCHING_STATES_FROM_MANAGERS = "FETCHING_STATES_FROM_MANAGERS",
    TEST_LIQUIDITY = "TEST_LIQUIDITY",
    FAILED_TEST_LIQUIDITY = "FAILED_TEST_LIQUIDITY",
    DELIVER_PRICE = "DELIVER_PRICE"
}

export function logger(debug: boolean, log_level: LogLevel, topic: LogTopic, msg: string) {
    if (log_level != LogLevel.DEBUG || debug) {
        console.log(`${Date.now()} ${log_level} ${topic} ${msg}`);
    }
}