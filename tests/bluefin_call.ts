async function pools() {
    const response = await (await fetch("https://swap.api.sui-prod.bluefin.io/api/v1/pools/info", {
        "headers": {
        "accept": "application/json, text/plain, */*",
        },
        "body": null,
        "method": "GET"
        })).json();
    console.log(response);
}

pools();