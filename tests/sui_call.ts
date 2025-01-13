import { Dex, Tick } from "../src/defs/pools";
import { ConfigManagerWithClient, PoolManagerWithClient } from "../src/defs/pool_manager";
import { Transaction } from "@mysten/sui/transactions";

const example_config_turbos: ConfigManagerWithClient = {
    dex: Dex.Cetus,
    debug: true,
    propose_pools_timer_ms: 600 * 1000,
    static_upgrade_timer_ms: 600 * 1000, // plays no role
    static_upgrade_wait_time_ms: 600 * 1000, // plays no role 
    dynamic_upgrade_timer_ms: 60 * 1000,
    dynamic_upgrade_wait_time_ms: 360 * 1000,
    sui_rpc_wait_time_ms: 2 * 1000,
    sui_simulation_address: "0xaed3970cd36bbd3a8d7deb0d06acb27d3ff69cc4fd4657cea3b8adfacebcd3c4"
}

const pool_manager = new PoolManagerWithClient(example_config_turbos);

function toSignedI128(i128: {bits: string}): bigint {
    const bits = BigInt(i128.bits)
    const TWO_127 = BigInt("170141183460469231731687303715884105728"); // 2**127
    const TWO_128 = BigInt("340282366920938463463374607431768211456"); // 2**128

    // Compare directly with BigInt constant
    return bits >= TWO_127 ? bits - TWO_128 : bits;
}

function toSignedI32(i32: {bits: string}): number {
    const bits = Number(i32.bits);
    const TWO_31 = 2 ** 31; // 2^31
    const TWO_32 = 2 ** 32; // 2^32

    // If the number is greater than or equal to 2^31, it's negative
    return bits >= TWO_31 ? bits - TWO_32 : bits;
}

function parseEvent(event_vector: {index: {bits: string}, liquidity_net: {bits: string}}[]): Tick[] {
    return event_vector.map((e) => {
        return {tick_index: toSignedI32(e.index), liquidity_net: toSignedI128(e.liquidity_net)}
    })
} 

async function create_txn_and_simulate() {
    const package_id = "0x4fbe59d114bdfb2066c5664933475286f184b6eb8c3f348ec8e91f60e565df15"

    const typeArguments = [
        '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN',
        '0x2::sui::SUI']

    const pool_ids = ["0xcf994611fd4c48e277ce3ffd4d4364c914af2c3cbb05f7bf6facd371de688630"]

    const tx = new Transaction();

    const pools = pool_ids.map((pool_id) => tx.object(pool_id))
    
    const liquidity_vector = tx.moveCall({
        target: `${package_id}::liquidity::get_liquidity`,
        arguments: [...pools],
        typeArguments
    })

    tx.moveCall({
        target: `${package_id}::liquidity::emit_single_ticks`,
        arguments: [liquidity_vector[0]]
    })

    try {
        const response = await pool_manager.simulateTransaction(tx) 
        const liquidity_vector = parseEvent((response.transactionResponse.events[0].parsedJson as {'data': {index: {bits: string}, liquidity_net: {bits: string}}[]}).data);
        console.log(liquidity_vector)
        console.log(response.receipt)    
    }
    catch (error) {
        console.log(error)
    }
}

create_txn_and_simulate();