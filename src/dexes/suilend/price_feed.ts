import { MoveStruct, SuiObjectResponse } from "@mysten/sui/client";
import { ObjectFeed, ParserTarget } from "../../defs/object_feed";
import { suilend_lending_market_id, vault_config } from "./config";

const suilend_decimals = 18;

// from suilend decimal to float representation
function floor_decimal(s: string): number {
  const len = s.length;
  if (len <= suilend_decimals) return Number('0.' + s.padStart(suilend_decimals, '0'));
  const intPart = s.slice(0, len - suilend_decimals);
  const fracPart = s.slice(len - suilend_decimals).replace(/0+$/, ''); // strip trailing zeros
  return fracPart ? Number(`${intPart}.${fracPart}`) : Number(intPart);
}

interface Borrow  {
    fields: {
        borrowed_amount: {
            fields: {value: string}
            type: "0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf::decimal::Decimal"
        }
        reserve_array_index: string
        coin_type: {
            fields: {name: string},
            type: "0x1::type_name::TypeName"
        }
        cumulative_borrow_rate: {
            fields: {
                value: string
            },
            type: "0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf::decimal::Decimal"
        }
    }
    type: string
}

interface Deposit {
    fields: {
        deposited_ctoken_amount: string, // not decimal: u64
        reserve_array_index: string
        coin_type: {
            fields: {name: string},
            type: "0x1::type_name::TypeName"
        }
    }
    type: string
}

interface Reserve {
    fields: {
        array_index: string,
        ctoken_supply: string // not decimal: u64 
        available_amount: string, // not decimal: u64       
        borrowed_amount: {
            fields: {
                value: string
            },
            type: "0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf::decimal::Decimal"
        },
        cumulative_borrow_rate: {
            fields: {
                value: string
            },
            type: "0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf::decimal::Decimal"
        },
        unclaimed_spread_fees: {
            fields: {
                value: string
            },
            type: "0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf::decimal::Decimal"
        }
        price_last_update_timestamp_s: string // last update in secs
    },
    type: "0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf::reserve::Reserve<0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf::suilend::MAIN_POOL>"
}

interface ObligationFields {
    borrows: Borrow[],
    deposits: Deposit[]
}

interface MarketFields {
    reserves: Reserve[]
}

function create_parser(lending_account: string,  qt: number, e_minus_one: number, price_formula: (prices: number[]) => number) {
    function parser(objects: SuiObjectResponse[]): ParserTarget {
        const c = objects[0];
        const timestamp_ms = ((c.data?.content as {fields: MoveStruct}).fields as {[key: string]: string}).timestamp_ms;
        
        // fetch main deposits and borrows
        const obligation = (objects[1].data?.content as {fields: MoveStruct}).fields as unknown as ObligationFields;
        
        // only interested in reserves 
        const market = (objects[2].data?.content as {fields: MoveStruct}).fields as unknown as MarketFields;

        // assume main deposit is first
        const deposit = obligation.deposits[0];
        const deposit_reserve = market.reserves[Number(deposit.fields.reserve_array_index)]

        // total supply as float approximating u64 value
        const total_supply = Number(deposit_reserve.fields.available_amount) + floor_decimal(deposit_reserve.fields.borrowed_amount.fields.value) - floor_decimal(deposit_reserve.fields.unclaimed_spread_fees.fields.value)
        const ctoken_ratio = total_supply/Number(deposit_reserve.fields.ctoken_supply)
        const supply = Math.floor(ctoken_ratio * Number(deposit.fields.deposited_ctoken_amount))

        const debt_object = obligation.borrows[0];
        const debt_stale = floor_decimal(debt_object.fields.borrowed_amount.fields.value);
        const debt_array_index = Number(debt_object.fields.reserve_array_index);
        const obligation_cumulative_rate = Number(debt_object.fields.cumulative_borrow_rate.fields.value)
        const debt_reserve = market.reserves[debt_array_index];
        const reserve_cumulative_rate = Number(debt_reserve.fields.cumulative_borrow_rate.fields.value)
        const interest_factor = reserve_cumulative_rate/obligation_cumulative_rate;
        const debt = Math.floor((debt_stale * interest_factor));

        // find the ref price
        const ref_pools = objects.slice(3);
        const ref_sqrtprices: number[] = [];
        for (const pool_object of ref_pools) {
            const content = pool_object.data!.content!
            const  fields = (content as unknown as {fields: {current_sqrt_price?: string, sqrt_price?: string}}).fields;
            const sqrt_price = fields.current_sqrt_price ?? fields.sqrt_price!
            ref_sqrtprices.push(Number(sqrt_price)/2**64)
        }
        const ref_sqrtprice = price_formula(ref_sqrtprices);

        const q = (ref_sqrtprice)**2 * supply/debt;
        const deviation = q/qt - 1
        const vault_sqrtprice = ref_sqrtprice * ( 1 + 0.5 * e_minus_one * deviation);
        const liquidity = (2/e_minus_one) * vault_sqrtprice * supply;

        const x = Math.floor(liquidity/vault_sqrtprice);
        const y = Math.floor(liquidity * vault_sqrtprice); 

        const ret: {[id: string]: string|{b: string[]}} = {timestamp_ms};
        // 
        ret[lending_account] = {b: [x.toString(), y.toString()]}

        return ret
    }
    return parser
}


export function create_virtual_balances_feed(lending_account: string, id_obligation:string, id_market: string, ref_pool_ids: string[], qt: number, e_minus_one: number, price_formula: (prices: number[]) => number) {
    const feed = new ObjectFeed(`Suilend_${lending_account}`, ["0x0000000000000000000000000000000000000000000000000000000000000006", id_obligation, id_market, ...ref_pool_ids], create_parser(lending_account, qt, e_minus_one, price_formula));
    return feed
}

export function create_suilend_feed(lending_account: string): ObjectFeed{
    const config = vault_config[lending_account];
    const id_obligation = config.obligation_id;
    const id_market = suilend_lending_market_id;
    const ref_pool_ids = config.ref_pools;
    const qt = Number(config.qt)/2**64;
    const e_minus_one = Number(config.e_minus_one)/2**64;
    const price_formula = config.price_formula;
    return create_virtual_balances_feed(lending_account, id_obligation, id_market, ref_pool_ids, qt, e_minus_one, price_formula);
}
