
type SteamApiPoolsResponse = SteamBasicPoolInfoRaw[]   

interface SteamBasicPoolInfoRaw {
  pool: {
    $typeName: string,
    $typeArgs: string[],
    id: string,
    balanceA: {
      value: string,
    },
    balanceB: {
      value: string,
    },
    lpSupply: {
      value: string,
    },
    protocolFees: {
      config: {
        feeNumerator: string,
        feeDenominator: string,
        minFee: string,
      },
      feeA: {
        value: string,
      },
      feeB: {
        value: string,
      },
    },
    poolFeeConfig: {
      feeNumerator: string,
      feeDenominator: string,
      minFee: string,
    }
  },
  poolInfo: {
    poolId: string,
    coinTypeA: string,
    coinTypeB: string,
    lpTokenType: string,
    quoterType: string,
    swapFeeBps: number,
  }
}

interface SteamBasicPoolInfo {
  pool: {
    $typeName: string,
    $typeArgs: string[],
    id: string,
    balanceA: {
      value: string,
    },
    balanceB: {
      value: string,
    },
    fees24h: string,
    volume24h: string, 
    lpSupply: {
      value: string,
    },
    protocolFees: {
      config: {
        feeNumerator: string,
        feeDenominator: string,
        minFee: string,
      },
      feeA: {
        value: string,
      },
      feeB: {
        value: string,
      },
    },
    poolFeeConfig: {
      feeNumerator: string,
      feeDenominator: string,
      minFee: string,
    }
  },
  poolInfo: {
    poolId: string,
    coinTypeA: string,
    coinTypeB: string,
    lpTokenType: string,
    quoterType: string,
    swapFeeBps: number,
  }
}

async function steam_pools() {
    const response_pools: SteamApiPoolsResponse = await (await fetch("https://global.suilend.fi/steamm/pools/all", {
        "headers": {
                "accept": "application/json, text/plain, */*",
                },
        "body": null,
        "method": "GET"
        })).json();
    
    const response_tvl = await (await fetch("https://global.suilend.fi/steamm/stats/all", {
         "headers": {
                "accept": "application/json, text/plain, */*",
                },
        "body": null,
        "method": "GET"
        })).json();

    console.log(response_pools);
    console.log(response_tvl.pools);
    
    const response = response_pools.map((p) => {
        const p_pool = {...p.pool, fees24h: "", volume24h: ""};
        const pool: SteamBasicPoolInfo = {...p, pool: p_pool};
        const id = p.poolInfo.poolId;
        const meta_info: {fee24h: string, volume24h: string}|undefined = response_tvl.pools[id];
        if (meta_info) {pool.pool = {...pool.pool, ...meta_info}}
        return pool
    }).filter((p) => p.pool.volume24h != undefined && p.pool.volume24h != '')

    console.log(response)
}

steam_pools();