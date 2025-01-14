async function call_pools() {
    const response = await (await 
        fetch("https://api-service-81678480858.asia-northeast1.run.app/pools/v3", {
          "headers": {
            "accept": "*/*",
          },
          "body": null,
          "method": "GET"
        })).json();
  console.log(response);
}

call_pools();