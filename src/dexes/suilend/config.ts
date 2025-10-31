// tokens
interface TokenInfo {
    type: string,
    pyth_price_object_id?: string,
    suilend_reserve_index: number,
    decimals: number
}

export const token_info: {[name: string]: TokenInfo} = {
    "WBTC": {
        type: "aafb102dd0902f5055cadecd687fb5b71ca82ef0e0285d90afde828ec58ca96b::btc::BTC",
        pyth_price_object_id: "0x9a62b4863bdeaabdc9500fce769cf7e72d5585eeb28a6d26e4cafadc13f76ab2",
        suilend_reserve_index: 21,
        decimals: 8
    },
    "SUI": {
        type: "0000000000000000000000000000000000000000000000000000000000000002::sui::SUI",
        pyth_price_object_id: undefined,
        suilend_reserve_index: 0,
        decimals: 9
    },
    "SPRINGSUI": {
        type: "83556891f4a0f233ce7b05cfe7f957d4020492a34f5405b2cb9377d060bef4bf::spring_sui::SPRING_SUI",
        pyth_price_object_id: "0x801dbc2f0053d34734814b2d6df491ce7807a725fe9a01ad74a07e9c51396c37",
        suilend_reserve_index: 10,
        decimals: 9
    },
    "DEEP": {
        type: "deeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP",
        pyth_price_object_id: "0x8c7f3a322b94cc69db2a2ac575cbd94bf5766113324c3a3eceac91e3e88a51ed",
        suilend_reserve_index: 8,
        decimals: 6
    },
    "USDC": {
        type: "dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
        pyth_price_object_id: "0x5dec622733a204ca27f5a90d8c2fad453cc6665186fd5dff13a83d0b6c9027ab",
        suilend_reserve_index: 7,
        decimals: 6
    },
    "USDT": {
        type: "375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT",
        suilend_reserve_index: 19,
        pyth_price_object_id: "0x985e3db9f93f76ee8bace7c3dd5cc676a096accd5d9e09e9ae0fb6e492b14572",
        decimals: 6
    }
}

// suilend integration, our package
export const suilend_integration_package_id = "0x14aa3a73d28673ba2f103d1950b0a6ef4d5209aaf8c3b3144e7a58d551431bef"

// suilend packages 
export const suilend_package_id = "0xdf6df8a1e16c58b66d5c432cc6a5a8981c9982f111723ec0894d152be57b3e7e"
export const suilend_lending_market_id = "0x84030d26d85eaa7035084a057f2f11f701b7e2e4eda87551becbc7c97505ece1"

export const P = "0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf::suilend::MAIN_POOL";

const product = (prices: number[]) => {
    return prices.reduce((p,c) => p * c, 1)
}

// vault data 
export const vault_config : {[lending_account: string]: {type: string, obligation_id: string, deposit_token: string, debt_token: string, quote_token: string, fee: string, qt: string, e_minus_one: string, ref_pools: string[], price_formula: (prices: number[]) => number}} = {
    "0x90dbf049993b40ecc5bc473414e3f61fae69436a1d8594034b49ff708d47de23": {
        type: "0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf::lending_market::ObligationOwnerCap<0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf::suilend::MAIN_POOL>",
        obligation_id: "0x16bcceda360f6576f8eca5da2bb9ace2f1332b821bd47ab38b0240e8818428a7",
        fee: "3689348814741910",
        qt: "36893488147419103232",
        e_minus_one: "1844674407370955161",
        ref_pools: ["0xf0e4772e80800550368973d1f8ab2c9a7241ace8df8770452ee2bf3e3e67b8a1", "0xb8a67c149fd1bc7f9aca1541c61e51ba13bdded64c273c278e50850ae3bff073"],
        deposit_token: "WBTC",
        debt_token: "USDT",
        quote_token: "USDC",
        price_formula: product
    }
}