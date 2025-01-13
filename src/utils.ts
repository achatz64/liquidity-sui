import { Tick } from "./defs/pools";

export async function sleep(time_ms: number) {
    return new Promise((resolve) => setTimeout(resolve, time_ms));
}

export async function wait_for_call(last_request_ms: number, wait_time_ms: number) {
    while (Date.now() - last_request_ms < wait_time_ms) {
        await sleep(Math.min(Math.abs(wait_time_ms - (Date.now() - last_request_ms)), wait_time_ms));
    }
}

export function toSignedI128(i128: {bits: string}): bigint {
    const bits = BigInt(i128.bits)
    const TWO_127 = BigInt("170141183460469231731687303715884105728"); // 2**127
    const TWO_128 = BigInt("340282366920938463463374607431768211456"); // 2**128

    // Compare directly with BigInt constant
    return bits >= TWO_127 ? bits - TWO_128 : bits;
}

export function toSignedI32(i32: {bits: string}): number {
    const bits = Number(i32.bits);
    const TWO_31 = 2 ** 31; // 2^31
    const TWO_32 = 2 ** 32; // 2^32

    // If the number is greater than or equal to 2^31, it's negative
    return bits >= TWO_31 ? bits - TWO_32 : bits;
}

export function parseEvent(event_vector: {index: {bits: string}, liquidity_net: {bits: string}}[]): Tick[] {
    return event_vector.map((e) => {
        return {tick_index: toSignedI32(e.index), liquidity_net: toSignedI128(e.liquidity_net)}
    })
} 