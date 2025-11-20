import { json } from '@sveltejs/kit';
import Redis from 'ioredis';

// Connect to Redis (using the docker hostname 'localhost' works here because it's server-side)
const redis = new Redis("redis://127.0.0.1:6379");

export async function POST({ request }) {
    const body = await request.json();

    console.log("Received request from UI:", body);

    // NEW: Stream pattern
    // Command: XADD stream_name ID field value
    // '*' means "Redis, please generate a unique timestamp ID for me"
    // 'payload' is the key where we store our JSON string
    const streamId = await redis.xadd(
        'swiftgrid_stream', 
        '*', 
        'payload', 
        JSON.stringify(body)
    );

    console.log(`Job added to Stream. ID: ${streamId}`);

    return json({ success: true, streamId });
}