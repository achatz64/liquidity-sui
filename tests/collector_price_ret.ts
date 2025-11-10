import { DataRequest, PriceRetrieval, ResponsePriceRetrieval } from "../src/defs/collector";

const print_pool_price = "0x90dbf049993b40ecc5bc473414e3f61fae69436a1d8594034b49ff708d47de23";

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
            if (current.data[print_pool_price]) {
                console.log(current.data[print_pool_price]);
            }
            else {
                console.log(`${print_pool_price} not found in ${Object.keys(current.data).join(",")}`)
            }
            console.log((Date.now()/1000).toFixed(1) + " update")
        }
    }
    catch (error) {
        console.log(error);
    }
}, 1000)