import { SuiClient, SuiObjectResponse } from "@mysten/sui/client";

const MAX_OBJECT_PER_CALL = 30;

export type ParserTarget = {[key: string]: (string | string[]| {[key: string]: string|string[]})}

export class ObjectFeed {
    name: string;
    ids: string[];
    parser: (x: SuiObjectResponse[]) => ParserTarget;
    constructor(name: string, object_ids: string[], parser: (x: SuiObjectResponse[]) => ParserTarget) {
        this.name = name;
        this.ids = object_ids;
        if (this.ids.length > MAX_OBJECT_PER_CALL) {
            throw new Error("Too many objects")
        }
        this.parser = parser;
    }
}

export async function get_objects(feeds: ObjectFeed[], client: SuiClient): Promise<{[feed_name: string]: ParserTarget}> {
    // check different names
    const names = feeds.map((f) => f.name);
    const double = names.map((n, i) => names.filter((m, j) => n == m && j!=i))
    if (double.filter((v) => v.length > 0).length > 0) {
        throw new Error("Two feeds with the same name!")
    }

    const places: string[][] = [[]];
    const reservations: {[name: string]: [number, number][]} = {};
    for (const feed of feeds) {
        let current_row = places[places.length-1];
        const covered_feed_ids = feed.ids.filter((id) => current_row.includes(id))
        const to_store = feed.ids.length - covered_feed_ids.length;
        if (current_row.length + to_store > MAX_OBJECT_PER_CALL) {
            places.push([]);
            current_row = places[places.length-1]
        }

        const current_row_index = places.length - 1;
        reservations[feed.name] = []
        for (const id of feed.ids) {
            const already_contained = current_row.findIndex((v)=> v==id);
            if (already_contained < 0) {
                const current = current_row.length;
                current_row.push(id);
                reservations[feed.name].push([current_row_index, current])
            }
            else {
                reservations[feed.name].push([current_row_index, already_contained])
            }
        }
    }

    const responses = await Promise.all(places.map((ids) => client.multiGetObjects({ids, options: {"showContent": true}})));

    const ret: {[feed_name: string]: ParserTarget} = {};
    feeds.forEach((feed) => {
        const reservation = reservations[feed.name];
        const collect_objects: SuiObjectResponse[] = []
        for (const r of reservation) {
            collect_objects.push(responses[r[0]][r[1]]);
        }
        ret[feed.name] = feed.parser(collect_objects);
    })

    return ret;
}

export async function feed(callback: (data: {[feed_name: string]: ParserTarget}) => void, wait_time_ms: number, feeds: ObjectFeed[], client: SuiClient) {
    // eslint-disable-next-line no-constant-condition
    while (true) {
        try {
            const data = await get_objects(feeds, client);
            callback(data);
            await new Promise(resolve => setTimeout(resolve, wait_time_ms));
        }
        catch (error) {
            console.log(`${Date.now()} Object feed error: ${error}`)
            await new Promise(resolve => setTimeout(resolve, 2 * wait_time_ms));
        }
    }
}
