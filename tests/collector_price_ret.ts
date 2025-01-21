import { DataRequest, PriceRetrieval, ResponsePriceRetrieval } from "../src/defs/collector";

async function call(url: string, arg: DataRequest): Promise<ResponsePriceRetrieval> {
    const request: ResponsePriceRetrieval = await (await fetch(url, {
            "headers": {
                "accept": "*/*",
            },
            "body": JSON.stringify(arg),
            "method": "POST"
        })).json();
    
    return request;
}

const url = "http://localhost:7001/price_ret"
const current: {data: {[pool_address: string]: string|string[]}, timestamp: number} = {timestamp: 0, data: {}};

setInterval(async () => {
    const arg: PriceRetrieval = {timestamp: current.timestamp}; 
    try {
        const new_current = await call(url, arg);
        if (new_current.update) {
            current.timestamp = new_current.timestamp
            current.data = new_current.data!
            console.log((Date.now()/1000).toFixed(1) + " update")
        }
    }
    catch (error) {
        console.log(error);
    }
}, 100)