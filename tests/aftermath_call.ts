import { sleep } from "../src/utils";

async function call_pools() {
    const response_raw = await fetch("https://aftermath.finance/api/pools", {
        "headers": {
            "accept": "*/*",
            "content-type": "application/json",
        },
        "body": "{}",
        "method": "POST"
        });
    
    const response : AftermathBasicPoolInfo[]  = await response_raw.json();

    let i=0;
    while (i < response.length){
        console.log(i);
        const pool_ids = {poolIds: response.slice(i, i+100).map((x)=> x.objectId)};
        const stats: AftermathPoolStats[] = await ( await 
            fetch("https://aftermath.finance/api/pools/stats", {
                "headers": {
                  "accept": "*/*",
                  
                },
                "body": JSON.stringify(pool_ids),
                "method": "POST"
              })).json();
        i = i + 100;
        pool_ids.poolIds.forEach((address, j) => {
            const pool = response.filter((p) => p.objectId == address)[0];
            pool.stats = stats[j];
        });
        await sleep(1000);
    }
    console.log(response);
}

interface AftermathCoinInfo  {
    "weight": string, // e.g. "500000000000000000n"
    "balance": string, //e.g. "16090948578616763n"
    "tradeFeeIn": string, //e.g.  "10000000000000000n" 
    "tradeFeeOut": string, //e.g. "0n"
    "depositFee": string,
    "withdrawFee": string,
    "normalizedBalance": string, //e.g. "16090948578616763000000000000000000n"
    "decimalsScalar": string, //e.g. "1000000000000000000n"
    "decimals": number
}

interface AftermathBasicPoolInfo {
    "objectType": string, //
    "lpCoinType": string, // lp type, type aregument for pool calls
    "coins": {
        [coin_type: string]: AftermathCoinInfo
    },
    "objectId": string, // address
    "name": string,
    "lpCoinSupply": string, //e.g. "1000n"
    "illiquidLpCoinSupply": string, //e.g. "1000n"
    "flatness": string, //e.g. "0n"
    "lpCoinDecimals": number,
    stats?: AftermathPoolStats
}

interface AftermathPoolStats {
    volume: number,
    tvl: number,
    supplyPerLps: number[],
    lpPrice: number,
    fees: number,
    apr: number
}

call_pools();