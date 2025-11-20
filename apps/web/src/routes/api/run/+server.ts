import { json } from '@sveltejs/kit';
import Redis from 'ioredis';

// Connect to Redis (using the docker hostname 'localhost' works here because it's server-side)
const redis = new Redis("redis://127.0.0.1:6379");

export async function POST({ request }) {
    const body = await request.json();

    console.log("Received request from UI:", body);

    // Push to the SAME queue the Rust worker is listening to
    // Note: We must stringify the body to send it as a JSON string
    await redis.lpush('job_queue', JSON.stringify(body));

    return json({ success: true });
}