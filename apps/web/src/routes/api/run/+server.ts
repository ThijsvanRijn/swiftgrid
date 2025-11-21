import { json } from '@sveltejs/kit';
import Redis from 'ioredis';
import { db } from '$lib/server/db';
import { secrets } from '$lib/server/db/schema';
import type { WorkerJob } from '$lib/types/worker'; 

// Connect to Redis
const redis = new Redis("redis://127.0.0.1:6379");

/**
 * THE INJECTOR
 * Takes the payload and swaps {{$env.KEY}} with real database values.
 */
async function injectSecrets(job: WorkerJob) {
    // 1. Fetch Secrets
    const allSecrets = await db.select().from(secrets);
    const secretMap = new Map(allSecrets.map(s => [s.key, s.value]));

    const processString = (str: string) => {
        return str.replace(/{{(.*?)}}/g, (match, variablePath) => {
            const cleanPath = variablePath.trim();
            if (cleanPath.startsWith('$env.')) {
                const keyName = cleanPath.replace('$env.', '');
                return secretMap.get(keyName) || match;
            }
            return match;
        });
    };

    // 2. Check which type of node it is
    // The new structure: job.node = { type: "HTTP", data: { ... } }
    
    if (job.node.type === 'HTTP') {
        const data = job.node.data;

        // Inject into URL
        if (data.url) data.url = processString(data.url);

        // Inject into Headers
        if (data.headers) {
            for (const key in data.headers) {
                data.headers[key] = processString(data.headers[key]);
            }
        }

        // Inject into Body
        if (data.body) {
            if (typeof data.body === 'string') {
                data.body = processString(data.body);
            } else {
                let bodyStr = JSON.stringify(data.body);
                bodyStr = processString(bodyStr);
                try { data.body = JSON.parse(bodyStr); } catch {}
            }
        }
    } 
    
    // FUTURE: Add "CODE" injection here if needed

    return job;
}

export async function POST({ request }) {
    let job = await request.json() as WorkerJob; // Cast to new type

    console.log("Received Job. Injecting secrets...");
    
    // Secure Injection
    job = await injectSecrets(job);

    // Push to Redis
    const streamId = await redis.xadd(
        'swiftgrid_stream', 
        '*', 
        'payload', 
        JSON.stringify(job)
    );

    return json({ success: true, streamId });
}