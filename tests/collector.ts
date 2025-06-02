import { Collector, ConfigCollector } from "../src/defs/collector";

const config: ConfigCollector = {
    debug: true,
    server_port: 7001,
    worker_urls: ["http://localhost:6001/", "http://localhost:6002/", "http://localhost:6003/", "http://localhost:6004/", "http://localhost:6005/", "http://localhost:6006/", "http://localhost:6007"] // cetus, aftermath, bluefin, turbos, kriya, momentum, steam
}

const collector = new Collector(config);

collector.run()