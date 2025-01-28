import { logger, LogLevel, LogTopic } from "./logging"
import { Dex } from "./pools"

// external
import * as http from 'http';

export interface ConfigCollector {
    debug: boolean
    worker_urls?: string[]
    server_port?: number
}

export class Collector {
    config: ConfigCollector
    state_delivery: {[dex: string]: 
        {data: string, timestamp: number}
    }
    price_delivery: {data: {[pool_address: string]: string|string[]}, timestamp: number}; 

    constructor(config: ConfigCollector) {
        this.config = config
        this.state_delivery = {}
        this.price_delivery = {data: {}, timestamp: Date.now()};
        for (const dex of Object.values(Dex)) {
            this.state_delivery[dex] = {data: JSON.stringify([]), timestamp: 0}
        }
    }

    create_server(): http.Server {
        const server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
            const { method, url } = req;
    
            try {
                if (method === 'POST' && url?.includes("delivery")) {
                    let body = '';
            
                    req.on('data', (chunk) => {
                        body += chunk.toString();
                    });
            
                    req.on('end', () => {
                        try {
                            const {dex, timestamp, data}: ManagerResponse = JSON.parse(body);
                            this.state_delivery[dex] = {data, timestamp}
                            res.writeHead(200, {'Content-Type': 'text/plain'});
                            res.end('');
                        } catch (error) {
                            res.writeHead(500, {'Content-Type': 'text/plain'});
                            res.end(`${(error as Error).message}`);
                        }
                    });

                } 
                else if (method === 'POST' && url?.includes("retrieval")) {
                    let body = '';
            
                    req.on('data', (chunk) => {
                        body += chunk.toString();
                    });
            
                    req.on('end', () => {
                        try {
                            const request: DataRequest = JSON.parse(body);
                            
                            const response: {[dex: string]: {data: string, timestamp: number}} = {}; 
                            for (const dex of Object.values(Dex)) {
                                if (request[dex] === undefined) {
                                    response[dex] = {...this.state_delivery[dex]}
                                }
                                else {
                                    const timestamp: number = request[dex];
                                    if (timestamp != this.state_delivery[dex].timestamp) {
                                        response[dex] = {...this.state_delivery[dex]}
                                    } 
                                }
                            }
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify(response));
                        } catch (error) {
                            res.writeHead(500, {'Content-Type': 'text/plain'});
                            res.end(`${(error as Error).message}`);
                        }
                    });
                }
                else if (method === 'POST' && url?.includes("price_del")) {
                    let body = '';
            
                    req.on('data', (chunk) => {
                        body += chunk.toString();
                    });
            
                    req.on('end', () => {
                        try {
                            const {timestamp, data}: PriceManagerDelivery = JSON.parse(body);
                            if (timestamp > this.price_delivery.timestamp) {
                                this.price_delivery = {timestamp, data};
                            }
                            res.writeHead(200, {'Content-Type': 'text/plain'});
                            res.end('');
                        } catch (error) {
                            res.writeHead(500, {'Content-Type': 'text/plain'});
                            res.end(`${(error as Error).message}`);
                        }
                    });

                } 
                else if (method === 'POST' && url?.includes("price_ret")) {
                    let body = '';
            
                    req.on('data', (chunk) => {
                        body += chunk.toString();
                    });
            
                    req.on('end', () => {
                        try {
                            const request: PriceRetrieval = JSON.parse(body);
                            
                            let response: string = JSON.stringify({timestamp: this.price_delivery.timestamp, update: false}); 

                            if (request.timestamp < this.price_delivery.timestamp) {
                                response = JSON.stringify({...this.price_delivery, update: true});
                            }
                            
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(response);
                        } catch (error) {
                            res.writeHead(500, {'Content-Type': 'text/plain'});
                            res.end(`${(error as Error).message}`);
                        }
                    });
                }
                else {
                    throw new Error(`Request method ${method} and url ${url} not supported`);
                }
            } catch (error) {
                this.handleError(res, error);
            }
        });
    
        return server;
    }

    private handleError(res: http.ServerResponse, error: unknown): void {
        const errorMessage = (error instanceof Error) ? error.message : 'Unknown error';
        logger(this.config.debug, LogLevel.ERROR, LogTopic.SERVER_REQUEST, errorMessage);
    
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server Error');
    }

    async retrieve() {
        if (this.config.worker_urls) {
            logger(this.config.debug, LogLevel.WORKFLOW, LogTopic.FETCHING_STATES_FROM_MANAGERS, "Starting");
            for (const url of this.config.worker_urls) {
                try {
                    const response: ManagerResponse = await (await 
                        fetch(url, {
                            "headers": {
                                "accept": "*/*",
                            },
                            "body": null,
                            "method": "GET"})).json();
                    this.state_delivery[response.dex] = {data: response.data, timestamp: response.timestamp};
                    logger(this.config.debug, LogLevel.DEBUG, LogTopic.FETCHING_STATES_FROM_MANAGERS, `${url} fetch successful`);        
                }
                catch (error) {
                    const errorMessage = (error instanceof Error) ? error.message : 'Unknown error';
                    logger(this.config.debug, LogLevel.ERROR, LogTopic.FETCHING_STATES_FROM_MANAGERS, `${url} ${errorMessage}`);
                }
            }
        }
    }

    async run() {
        await this.retrieve();

        if (this.config.server_port) {
            const server = this.create_server();

            server.listen(this.config.server_port, () => {
                logger(this.config.debug, LogLevel.WORKFLOW, LogTopic.SERVER, 
                    `Server running at http://localhost:${this.config.server_port}/`);
            });
        
            server.on('error', (error: NodeJS.ErrnoException) => {
                logger(this.config.debug, LogLevel.CRITICAL, LogTopic.SERVER, 
                    `Server stopped. ${error.message}`);
            });
        }
    }
}

interface ManagerResponse {
    data: string,
    timestamp: number,
    dex: Dex
}

interface PriceManagerDelivery {
    data: {[pool_address: string]: string|string[]},
    timestamp: number
}

export type DataRequest = {
    [dex: string]: number
}

export type PriceRetrieval = {
    timestamp: number
}

export interface ResponsePriceRetrieval {
    timestamp: number,
    update: boolean,
    data?: {[pool_address: string]: string|string[]}
}