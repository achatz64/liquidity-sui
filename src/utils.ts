export async function sleep(time_ms: number) {
    return new Promise((resolve) => setTimeout(resolve, time_ms));
}

export async function wait_for_call(last_request_ms: number, wait_time_ms: number) {
    while (Date.now() - last_request_ms < wait_time_ms) {
        await sleep(Math.min(Math.abs(wait_time_ms - (Date.now() - last_request_ms)), wait_time_ms));
    }
}