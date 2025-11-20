import Redis from 'ioredis';

export function GET() {
    const redis = new Redis("redis://127.0.0.1:6379");
    const streamKey = 'swiftgrid_results';

    let active = true;

    const stream = new ReadableStream({
        async start(controller) {
            console.log("Client connected to SSE stream");

            // We use the '$' ID to listen only for NEW messages arriving after connection
            let lastId = '$';

            while (active) {
                try {
                    // BLOCK for 10 seconds waiting for data
                    // XREAD BLOCK 10000 STREAMS swiftgrid_results $
                    const result = await redis.xread('BLOCK', 10000, 'STREAMS', streamKey, lastId);

                    if (result) {
                        const [key, messages] = result[0]; // stream_key, array of messages
                        
                        for (const message of messages) {
                            const [id, fields] = message;
                            lastId = id; // Update cursor
                            
                            // Redis returns fields as [key, value, key, value]
                            // We know we stored it as "payload"
                            const payloadIndex = fields.indexOf('payload');
                            if (payloadIndex !== -1) {
                                const jsonString = fields[payloadIndex + 1];
                                
                                // Send to Browser
                                // SSE Format: "data: <content>\n\n"
                                const sseMessage = `data: ${jsonString}\n\n`;
                                controller.enqueue(sseMessage);
                            }
                        }
                    }
                } catch (err) {
                    console.error("Redis Stream Error:", err);
                    // If connection lost, maybe retry or exit
                }
            }
        },
        cancel() {
            console.log("Client disconnected");
            active = false;
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