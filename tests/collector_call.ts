import { DataRequest } from "../src/defs/collector";

async function call(url: string, arg: DataRequest): Promise<{[dex: string]: {data: string, timestamp: number}}> {
    const request: {[dex: string]: {data: string, timestamp: number}} = await (await fetch(url, {
            "headers": {
                "accept": "*/*",
            },
            "body": JSON.stringify(arg),
            "method": "POST"
        })).json();
    
    return request;
}

const url = "http://localhost:7001/retrieval"
const current: {[dex: string]: {data: string, timestamp: number}} = {};

setInterval(async () => {
    const arg: DataRequest = {}
    for (const dex in current) {
        arg[dex] = current[dex].timestamp; 
    }
    try {
        const new_current = await call(url, arg);
        for (const dex in new_current) {
            console.log(`For ${dex} new timestamp ${new_current[dex].timestamp}`)
            current[dex] = new_current[dex];
        }
    }
    catch (error) {
        console.log(error);
    }
}, 2000)