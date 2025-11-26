import Redis from 'ioredis';
import { env } from '$env/dynamic/private';
import { REDIS_STREAMS } from '@swiftgrid/shared';

const HEARTBEAT_INTERVAL_MS = 30000; // Send heartbeat every 30s
const REDIS_BLOCK_MS = 5000; // Block for 5s waiting for data (shorter for better chunk responsiveness)

export function GET() {
    const redis = new Redis(env.REDIS_URL ?? 'redis://127.0.0.1:6379');

    let active = true;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream({
        async start(controller) {
            console.log('SSE: Client connected');

            // Send immediate "connected" event so the browser knows we're live
            controller.enqueue(': connected\n\n');

            // Heartbeat keeps the connection alive through proxies/load balancers
            heartbeatTimer = setInterval(() => {
                if (active) {
                    try {
                        controller.enqueue(': heartbeat\n\n');
                    } catch {
                        // Controller closed, stop heartbeat
                        if (heartbeatTimer) clearInterval(heartbeatTimer);
                    }
                }
            }, HEARTBEAT_INTERVAL_MS);

            // Listen for new messages on both streams ($ = latest)
            let lastResultsId = '$';
            let lastChunksId = '$';
            let errorCount = 0;
            const MAX_ERRORS = 5;

            while (active) {
                try {
                    // Listen to both RESULTS (node completions) and CHUNKS (streaming output)
                    const result = await redis.xread(
                        'BLOCK', REDIS_BLOCK_MS, 
                        'STREAMS', 
                        REDIS_STREAMS.RESULTS, REDIS_STREAMS.CHUNKS,
                        lastResultsId, lastChunksId
                    );

                    if (result) {
                        for (const [streamName, messages] of result) {
                            for (const message of messages) {
                                const [id, fields] = message;
                                
                                // Update the appropriate lastId
                                if (streamName === REDIS_STREAMS.RESULTS) {
                                    lastResultsId = id;
                                } else if (streamName === REDIS_STREAMS.CHUNKS) {
                                    lastChunksId = id;
                                }
                                
                                const payloadIndex = fields.indexOf('payload');
                                if (payloadIndex !== -1) {
                                    const jsonString = fields[payloadIndex + 1];
                                    
                                    // Use SSE event types to distinguish between results and chunks
                                    if (streamName === REDIS_STREAMS.CHUNKS) {
                                        controller.enqueue(`event: chunk\ndata: ${jsonString}\n\n`);
                                    } else {
                                        controller.enqueue(`event: result\ndata: ${jsonString}\n\n`);
                                    }
                                }
                            }
                        }
                    }

                    // Reset error count on success
                    errorCount = 0;
                } catch (err) {
                    errorCount++;
                    console.error(`SSE: Redis error (${errorCount}/${MAX_ERRORS}):`, err);

                    // Break out if too many consecutive errors
                    if (errorCount >= MAX_ERRORS) {
                        console.error('SSE: Too many errors, closing stream');
                        active = false;
                        break;
                    }

                    // Brief pause before retry
                    await new Promise(r => setTimeout(r, 1000));
                }
            }

            controller.close();
        },
        cancel() {
            console.log('SSE: Client disconnected');
            active = false;
            if (heartbeatTimer) clearInterval(heartbeatTimer);
            redis.disconnect();
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        }
    });
}