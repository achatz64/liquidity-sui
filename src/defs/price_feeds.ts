import { MoveStruct, SuiObjectResponse } from "@mysten/sui/client";
import { ObjectFeed, ParserTarget } from "../defs/object_feed";
import { Dex } from "./pools";

// argument dex is not quite the dex but of the form `${dex}_${some_number}`
function create_parser(dex: string): (pools: SuiObjectResponse[]) => ParserTarget {
    function parser(clock: SuiObjectResponse[]): ParserTarget {
        const c = clock[0];
        const pools = clock.slice(1);
        const ret: ParserTarget = {timestamp_ms: ((c.data?.content as {fields: MoveStruct}).fields as {[key: string]: string}).timestamp_ms};
        for (const pool_object of pools) {
            const id = pool_object.data!.objectId;
            const content = pool_object.data!.content!;

            let sqrt_price: string;
            if (dex.startsWith(Dex.Cetus) || dex.startsWith(Dex.Bluefin)) {
                sqrt_price = (content as unknown as {fields: {current_sqrt_price: string, liquidity: string}}).fields.current_sqrt_price;
                ret[id] = {
                    sp: sqrt_price
                }
            }
            if (dex.startsWith(Dex.Momentum) || dex.startsWith(Dex.Turbos)) {
                sqrt_price = (content as unknown as {fields: {sqrt_price: string, liquidity: string}}).fields.sqrt_price;
                ret[id] = {
                    sp: sqrt_price
                }
            }
            if (dex.startsWith(Dex.Aftermath)) {
                const decimal_scalars = (content as unknown as {fields: {decimal_scalars: string[]}}).fields.decimal_scalars;
                const balances = (content as unknown as {fields: {normalized_balances: string[]}}).fields.normalized_balances
                                    .map((value, i) => Math.floor(Number(value)/Number(decimal_scalars[i])).toString())
                ret[id] = {b: balances}
            }
            if (dex.startsWith(Dex.Kriya)) {
                const content_fields = (content as unknown as {fields: {sqrt_price?: string, token_x?: string, token_y?: string}}).fields;
                if (content_fields.sqrt_price) {
                    ret[id] = {sp: content_fields.sqrt_price as string}
                }
                else {
                    const balances = [content_fields.token_x!, content_fields.token_y!]
                    ret[id] = {b: balances}
                }
            }
        }
        //console.log(`Parsed ${Object.keys(ret).length} ids for ${dex}`);
        return ret;
    }
    return parser
}


export function create_pool_feed(dex_name: string, pool_ids : string[]) {
    const feed = new ObjectFeed(`${dex_name}`, ["0x0000000000000000000000000000000000000000000000000000000000000006", ...pool_ids], create_parser(dex_name));
    return feed
}