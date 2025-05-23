async function momentum_pools() {
    const response = await (await fetch("https://api.mmt.finance/pools/v3", {
  "headers": {
        "accept": "application/json, text/plain, */*",
        },
  "body": null,
  "method": "GET"
})).json();
    console.log(response);
}

momentum_pools();