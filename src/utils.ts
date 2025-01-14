import { Tick } from "./defs/pools";
import { LiquidityWindow } from "./dexes/bluefin/pool_manager";

export async function sleep(time_ms: number) {
    return new Promise((resolve) => setTimeout(resolve, time_ms));
}

export async function wait_for_call(last_request_ms: number, wait_time_ms: number) {
    while (Date.now() - last_request_ms < wait_time_ms) {
        await sleep(Math.min(Math.abs(wait_time_ms - (Date.now() - last_request_ms)), wait_time_ms));
    }
}

export function to_signed_i128(i128: {bits: string}): bigint {
    const bits = BigInt(i128.bits)
    const TWO_127 = BigInt("170141183460469231731687303715884105728"); // 2**127
    const TWO_128 = BigInt("340282366920938463463374607431768211456"); // 2**128

    // Compare directly with BigInt constant
    return bits >= TWO_127 ? bits - TWO_128 : bits;
}

export function to_signed_i32(i32: {bits: string}): number {
    const bits = Number(i32.bits);
    const TWO_31 = 2 ** 31; // 2^31
    const TWO_32 = 2 ** 32; // 2^32

    // If the number is greater than or equal to 2^31, it's negative
    return bits >= TWO_31 ? bits - TWO_32 : bits;
}

export function parse_event(event_vector: {index: {bits: string}, liquidity_net: {bits: string}}[]): Tick[] {
    return event_vector.map((e) => {
        return {tick_index: to_signed_i32(e.index), liquidity_net: to_signed_i128(e.liquidity_net)}
    })
} 

export function parse_liquidity_window_event(event_object: {
        current_liquidity: string,
        current_tick: {bits: string},
        tick_spacing: string,
        window_size: string,
        ticks: {index: {bits: string}, liquidity_net: {bits: string}}[]
    }): LiquidityWindow {
    return {
        current_liquidity: BigInt(event_object.current_liquidity),
        current_tick: to_signed_i32(event_object.current_tick),
        tick_spacing: Number(event_object.tick_spacing),
        window_size: Number(event_object.window_size),
        ticks: parse_event(event_object.ticks)
    }
}

export function liquidity_window_to_liquidity(window: LiquidityWindow): Tick[] {
    const smallest_tick_index = (Math.floor(window.current_tick/window.tick_spacing) - window.window_size) * window.tick_spacing;
    if (window.ticks.filter((t) => t.tick_index == smallest_tick_index).length == 0) {
        window.ticks = [{tick_index: smallest_tick_index, liquidity_net: BigInt(0)}].concat(window.ticks)
    }

    window.ticks = window.ticks.sort((a, b) => a.tick_index - b.tick_index);
    const ticks_less_eq = window.ticks.filter((tick) => tick.tick_index <= window.current_tick)
    const ticks_greater = window.ticks.filter((tick) => tick.tick_index > window.current_tick)
    const liquidity_less_eq = ticks_less_eq.reduce((p, c) => p + c.liquidity_net, BigInt(0));
    const liquidity_greater = ticks_greater.reduce((p, c) => p + c.liquidity_net, BigInt(0));
    
    // modifications
    ticks_less_eq[0].liquidity_net = window.current_liquidity - liquidity_less_eq + ticks_less_eq[0].liquidity_net;
    ticks_greater.push({
        tick_index: (Math.floor(window.current_tick/window.tick_spacing) + window.window_size + 1) * window.tick_spacing,
        liquidity_net: - liquidity_greater - window.current_liquidity  
    })
    const ticks_modified = ticks_less_eq.concat(ticks_greater);
    return ticks_modified
} 
