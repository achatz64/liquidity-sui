
export enum Model {
    None = "None",
    Linear = "Linear",
    Amm = "Amm",
    StableAmm = "StableAmm",
    Orderbook = "Orderbook",
    Balancer = "Balancer",
    KriyaStable = "KriyaStable",
    AftermathStable = "AftermathStable",
    UniswapV3 = "UniswapV3"
}

export enum Dex {
    Cetus = "Cetus",
    Aftermath = "Aftermath",
    Bluefin = "Bluefin",
    Kriya = "Kriya",
    Turbos = "Turbos"
}

export interface Tick {
    tick_index: number, 
    liquidity_net: bigint
}

export interface Pool {
    // required
    address: string,
    dex: Dex,

    // static
    model?: Model, 
    coin_types?: string[],
    pool_call_types?: string[],
    static_fee?: number // 100 * bps 
    //static_fee_multi?: {[coin_in_index: string]: {[coin_out_index: string]: number}},
    weights?: number[], // balancer
    stable_amplification?: number,
    tick_spacing?: number,
    
    // dynamic
    liquidity?: Tick[], // tick_index is I32 and fits in number, liquidity_net is I128
    orderbook?: {bids: {price: number, quantity: number}[], asks: {price: number, quantity: number}[]},

    // meta
    stats_balances?: bigint[], // per coin_type, u64
    tvl?: number // in usdc
    coin_decimals?: number[] // decimals of coin_types

    // workflow
    last_static_update?: {time_ms: number, success: boolean, counter: number}, 
    last_dynamic_upgrade?: {time_ms: number, success: boolean, counter: number}, 
    last_pull?: {time_ms: number, success: boolean, counter: number} 
    last_swap_ms?: number
    last_liquidity_modification_ms?: number
}

export interface PoolClmm extends Pool {
    coin_types: string[],
    static_fee: number
    tick_spacing: number, 
    sqrt_price: bigint,
    liquidity: {tick_index: number, liquidity_net: bigint}[],
}

export interface PoolAmm extends Pool {
    coin_types: string[],
    static_fee: number,
    balances: bigint[]
}

export interface PoolOrderbook extends Pool {
    coin_types: string[],
    static_fee: number,
    orderbook: {bids: {price: number, quantity: number}[], asks: {price: number, quantity: number}[]}
}

export interface PoolBalancer extends Pool {
    coin_types: string[],
    static_fee: number,
    balances: bigint[],
    weights: number[], 
}

export function check_pool(pool: Pool): boolean {
    return pool.address !== undefined && pool.dex !== undefined   
}

export function check_static(pool: Pool): boolean {
    if (pool.model == "UniswapV3") {
        return (pool.coin_types !== undefined && pool.static_fee !== undefined && pool.pool_call_types !== undefined && pool.tick_spacing !== undefined)
    }
    else if (pool.model == "Amm" || pool.model == "Orderbook" || pool.model == "KriyaStable" || pool.model == "AftermathStable")  {
        return (pool.coin_types !== undefined && pool.static_fee !== undefined && pool.pool_call_types !== undefined)
    }
    else if (pool.model == "StableAmm")  {
        return (pool.coin_types !== undefined && pool.static_fee !== undefined && pool.pool_call_types !== undefined && pool.stable_amplification !== undefined)
    }
    else if (pool.model == "Balancer") {
        return (pool.coin_types !== undefined && pool.static_fee !== undefined && pool.pool_call_types !== undefined && pool.weights !== undefined)
    }
    else {
        throw new Error(`Unrecognized model ${pool.model} for pool ${pool.address}`)
    }
}

export function check_dynamic(pool: Pool): boolean {
    const check_for_static =  check_static(pool);

    if (pool.model == "UniswapV3") {
        return check_for_static && pool.liquidity !== undefined
    }
    else if (pool.model == "Amm" || pool.model == "StableAmm" || pool.model == "KriyaStable" || pool.model == "AftermathStable")  {
        return check_for_static 
    }
    else if (pool.model == "Orderbook")  {
        return check_for_static &&  (pool.orderbook !== undefined)
    }
    else if (pool.model == "Balancer") {
        return check_for_static &&  (pool.weights !== undefined) 
    }
    else {
        throw new Error(`Unrecognized model ${pool.model} for pool ${pool.address}`)
    }
}

export function add_workflow_elements(pool: Pool) {
    pool.last_pull = {time_ms: 0, success: true, counter: 0};
    pool.last_swap_ms = 0; 
    pool.last_liquidity_modification_ms = 0; 
    pool.last_static_update = {time_ms: 0, success: false, counter: 0}; 
    pool.last_dynamic_upgrade = {time_ms: 0, success: false, counter: 0};
}

export function to_essential_json(pool: Pool): {
        address: string,
        dex: Dex,

        model?: Model, 
        coin_types?: string[],
        pool_call_types?: string[],
        static_fee?: number, // 100 * bps 
        stable_amplification?: number,
        tick_spacing?: number,
        
        // dynamic
        liquidity?: {tick_index: number, liquidity_net: string}[], 
        orderbook?: {bids: {price: number, quantity: number}[], asks: {price: number, quantity: number}[]}
    } {
    return {
        address: pool.address,
        dex: pool.dex,

        model: pool.model, 
        coin_types: pool.coin_types,
        pool_call_types: pool.coin_types,
        static_fee: pool.static_fee, // 100 * bps 
        stable_amplification: pool.stable_amplification,
        tick_spacing: pool.tick_spacing,
        
        // dynamic
        liquidity: pool.liquidity?.map((tick) => {
            return {tick_index: tick.tick_index, liquidity_net: tick.liquidity_net.toString()}
        }), 
        orderbook: pool.orderbook
    }
}

export function update_coin_decimals_per_pool(pool: Pool, coins_decimals: {[coin_type: string]: number})  {
    if (check_static(pool)) {
        const coin_decimals = pool.coin_types!.map((t) => coins_decimals[t]);
        if (coin_decimals.filter((n) => n == undefined).length == 0 ) {
            pool.coin_decimals = coin_decimals;
        }
    } 
}