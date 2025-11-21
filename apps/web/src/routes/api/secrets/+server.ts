import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { secrets } from '$lib/server/db/schema';
import { desc } from 'drizzle-orm';

// GET: List ALL keys (Safe for Frontend)
export async function GET() {
    try {
        // We ONLY select the 'key' column. 
        // We never send the 'value' to the frontend. Security 101.
        const allSecrets = await db.select({ 
            key: secrets.key,
            createdAt: secrets.createdAt
        })
        .from(secrets)
        .orderBy(desc(secrets.createdAt));

        return json(allSecrets);
    } catch (e) {
        console.error("Failed to fetch secrets", e);
        return json({ error: "Database error" }, { status: 500 });
    }
}

// POST: Save a Secret
export async function POST({ request }) {
    try {
        const { key, value } = await request.json();

        if (!key || !value) {
            return json({ error: "Missing key or value" }, { status: 400 });
        }

        // Clean the key (Uppercase, no spaces)
        // "My Api Key" -> "MY_API_KEY"
        const cleanKey = key.trim().toUpperCase().replace(/\s+/g, '_');

        // Upsert: Insert, or Update if the key already exists
        await db.insert(secrets)
            .values({ key: cleanKey, value })
            .onConflictDoUpdate({ 
                target: secrets.key, 
                set: { value } 
            });

        return json({ success: true, key: cleanKey });
    } catch (e) {
        console.error("Failed to save secret", e);
        return json({ error: "Database error" }, { status: 500 });
    }
}