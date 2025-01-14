async function call_pools_v2() {
    const response = await (await 
        fetch("https://api-service-81678480858.asia-northeast1.run.app/pools/v2", {
          "headers": {
            "accept": "*/*",
          },
          "body": null,
          "method": "GET"
        })).json();
  console.log(response);
}

call_pools_v2();