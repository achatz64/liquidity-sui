export enum LogLevel {
    ERROR = "ERROR",
    DEBUG = "DEBUG",
    CRITICAL = "CRITICAL"
}

export enum LogTopic {
    // critical
    UPDATER_STOPPED = "UPDATER_STOPPED",

    // else
    TVL_UPDATE = "TVL_UPDATE",
    COIN_DECIMALS_UPDATE = "COIN_DECIMALS_UPDATE",
    STATIC_UPDATE = "STATIC_UPDATE",
    DYNAMIC_UPDATE = "DYNAMIC_UPDATE",
    ADD_POOL = "ADD_POOL",
    REMOVE_POOL = "REMOVE_POOL"
}

export function logger(debug: boolean, log_level: LogLevel, topic: LogTopic, msg: string) {
    if (log_level != LogLevel.DEBUG || debug) {
        console.log(`${Date.now()} ${log_level} ${topic} ${msg}`);
    }
}