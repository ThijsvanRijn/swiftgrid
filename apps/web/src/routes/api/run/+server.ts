import { json } from '@sveltejs/kit';
import Redis from 'ioredis';
// Database imports
import { db } from '$lib/server/db';
import { secrets } from '$lib/server/db/schema';

// Connect to Redis
const redis = new Redis("redis://127.0.0.1:6379");

/**
 * THE INJECTOR
 * Takes the payload and swaps {{$env.KEY}} with real database values.
 */
async function injectSecrets(payload: any) {
    // 1. Fetch all secrets from the Vault
    const allSecrets = await db.select().from(secrets);
    // Convert to a Map for instant lookup: "OPENAI_KEY" -> "sk-..."
    const secretMap = new Map(allSecrets.map(s => [s.key, s.value]));

    // 2. Helper function to process a string
    const processString = (str: string) => {
        // Regex finds {{ ... }}
        return str.replace(/{{(.*?)}}/g, (match, variableContent) => {
            const cleanContent = variableContent.trim();
            
            // Check if it's an environment variable
            if (cleanContent.startsWith('$env.')) {
                const keyName = cleanContent.replace('$env.', '');
                
                // Retrieve from Vault
                const secretValue = secretMap.get(keyName);
                
                if (secretValue) {
                    return secretValue;
                } else {
                    console.warn(`Secret not found: ${keyName}`);
                    return match; // Leave it broken if not found
                }
            }
            
            // If it's NOT an env var (e.g. {{node_1.data}}), we leave it alone.
            // (Though the frontend should have already handled those!)
            return match;
        });
    };

    // 3. Inject into URL
    if (payload.url) {
        payload.url = processString(payload.url);
    }

    // 4. Inject into Headers (Iterate object)
    if (payload.headers) {
        for (const key in payload.headers) {
            const originalValue = payload.headers[key];
            payload.headers[key] = processString(originalValue);
        }
    }

    // 5. Inject into Body
    // The body might be a JSON object or a string. We handle both.
    if (payload.body) {
        // If it's an object, stringify -> replace -> parse
        // If it's a string, just replace
        let bodyStr = typeof payload.body === 'string' 
            ? payload.body 
            : JSON.stringify(payload.body);
            
        bodyStr = processString(bodyStr);

        try {
            // Try to convert back to JSON object
            payload.body = JSON.parse(bodyStr);
        } catch (e) {
            // If not valid JSON, keep as string
            payload.body = bodyStr;
        }
    }

    return payload;
}

export async function POST({ request }) {
    let body = await request.json();

    console.log("Backend received job. Injecting secrets...");

    // SECURE INJECTION
    // This happens inside the server, so the user NEVER sees the result in the browser.
    const securePayload = await injectSecrets(body);

    // Push to Stream
    const streamId = await redis.xadd(
        'swiftgrid_stream', 
        '*', 
        'payload', 
        JSON.stringify(securePayload)
    );

    console.log(`Job queued to Redis Stream: ${streamId}`);

    return json({ success: true, streamId });
}