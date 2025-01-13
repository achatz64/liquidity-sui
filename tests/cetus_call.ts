async function cetus_pools(limit=30, offset=0) {
    const response = await (await fetch(`https://api-sui.cetus.zone/v2/sui/stats_pools?is_vaults=false&display_all_pools=false&has_mining=true&has_farming=true&no_incentives=true&order_by=-vol&limit=${limit}&offset=${offset}`, {
        "headers": {
          "accept": "*/*",
        },
        "body": null,
        "method": "GET"
      })).json();
    console.log(response);
}

cetus_pools();