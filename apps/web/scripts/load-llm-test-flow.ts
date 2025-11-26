import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';

// Simple test flow: HTTP → LLM → Code
// Fetches a quote, asks LLM to analyze it, then formats the result

const testFlow = {
    nodes: [
        {
            id: 'http_fact',
            type: 'http-request',
            position: { x: 100, y: 100 },
            data: {
                label: 'Get Random Fact',
                url: 'https://uselessfacts.jsph.pl/api/v2/facts/random?language=en',
                method: 'GET',
                status: 'idle'
            }
        },
        {
            id: 'llm_analyze',
            type: 'llm',
            position: { x: 100, y: 250 },
            data: {
                label: 'Analyze Fact',
                baseUrl: 'https://api.groq.com/openai/v1',
                apiKey: '{{$env.GROQ_KEY}}',
                model: 'llama-3.1-8b-instant',
                systemPrompt: 'You are a fun science communicator. Keep responses under 50 words.',
                userPrompt: 'Here is a random fact:\n\n"{{http_fact.text}}"\n\nTell me something interesting about this or expand on it!',
                temperature: 0.7,
                stream: true,
                status: 'idle'
            }
        },
        {
            id: 'code_format',
            type: 'code-execution',
            position: { x: 100, y: 420 },
            data: {
                label: 'Format Result',
                code: `// Combine the fact and analysis
                const fact = INPUT.fact || 'No fact available';
                const analysis = INPUT.analysis || 'No analysis available';

                return {
                    formatted: '📚 Fact: ' + fact + '\\n\\n🤖 Analysis: ' + analysis,
                    wordCount: String(analysis).split(' ').length,
                    timestamp: new Date().toISOString()
                };`,
                inputs: JSON.stringify({
                    fact: '{{http_fact.text}}',
                    analysis: '{{llm_analyze.content}}'
                }),
                status: 'idle'
            }
        }
    ],
    edges: [
        { id: 'e1', source: 'http_fact', target: 'llm_analyze' },
        { id: 'e2', source: 'llm_analyze', target: 'code_format' }
    ],
    viewport: { x: 200, y: 50, zoom: 1 }
};

async function loadTestFlow() {
    const connectionString = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/swiftgrid';
    const client = postgres(connectionString);
    const db = drizzle(client);

    console.log('Loading LLM test flow...');

    // Update the most recent workflow with our test flow
    await db.execute(sql`
        UPDATE workflows 
        SET graph = ${JSON.stringify(testFlow)}::jsonb,
            name = 'LLM Test Flow',
            updated_at = NOW()
        WHERE id = (SELECT id FROM workflows ORDER BY created_at DESC LIMIT 1)
    `);

    console.log('✅ LLM test flow loaded!');
    console.log('');
    console.log('Flow structure:');
    console.log('  1. HTTP: Fetches a random fact from uselessfacts.jsph.pl');
    console.log('  2. LLM: Analyzes the fact using GPT-4o-mini');
    console.log('  3. Code: Formats the fact + analysis together');
    console.log('');
    console.log('⚠️  Make sure you have OPENAI_KEY in your secrets!');
    console.log('   Go to the Secrets Vault in the sidebar to add it.');

    await client.end();
}

loadTestFlow().catch(console.error);

