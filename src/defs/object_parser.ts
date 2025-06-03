import { Dex, Model } from "./pools";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function object_parser(object_data: {fields: {[keys: string]: any}, dex: Dex, id: string, model: Model}): {b?: string[], sp?: string} {
    if (object_data.dex == Dex.Cetus || object_data.dex == Dex.Bluefin) {
        return {sp: object_data.fields.current_sqrt_price as string}
    }
    if (object_data.dex == Dex.Turbos || object_data.dex == Dex.Momentum) {
        return {sp: object_data.fields.sqrt_price as string}
    }
    if (object_data.dex == Dex.Aftermath) {
        const balances = (object_data.fields.normalized_balances as string[])
            .map((value, i) => Math.floor(Number(value)/Number((object_data.fields.decimal_scalars as string[])[i])).toString())
        return {b: balances}
    }
    if (object_data.dex == Dex.Kriya) {
        if (object_data.model == Model.UniswapV3) {
            return {sp: object_data.fields.sqrt_price as string}
        }
        else {
            const balances = [object_data.fields.token_x, object_data.fields.token_y]
            return {b: balances}
        }
    }

    throw new Error("Unidentified dex")
}