/**
 * Stale-While-Revalidate cache for secrets
 * 
 * Secrets rarely change, so we cache them in memory with a 60s TTL.
 * This eliminates a DB query per workflow execution.
 */

import { db } from './db';
import { secrets } from './db/schema';

interface CachedSecrets {
	map: Map<string, string>;
	timestamp: number;
}

// Module-level cache (per Node.js process)
let cache: CachedSecrets | null = null;
const TTL_MS = 60_000; // 60 seconds

/**
 * Get secrets map with caching.
 * Returns cached value if fresh, otherwise fetches from DB.
 */
export async function getSecretsMap(): Promise<Map<string, string>> {
	const now = Date.now();
	
	// Return cached if still fresh
	if (cache && (now - cache.timestamp) < TTL_MS) {
		return cache.map;
	}
	
	// Fetch from DB
	const allSecrets = await db.select().from(secrets);
	const secretMap = new Map(allSecrets.map(s => [s.key, s.value]));
	
	// Update cache
	cache = {
		map: secretMap,
		timestamp: now
	};
	
	return secretMap;
}

/**
 * Invalidate the secrets cache.
 * Call this after creating/updating/deleting secrets.
 */
export function invalidateSecretsCache(): void {
	cache = null;
}

/**
 * Get cache stats for debugging
 */
export function getSecretsCacheStats(): { cached: boolean; age_ms: number | null } {
	if (!cache) {
		return { cached: false, age_ms: null };
	}
	return {
		cached: true,
		age_ms: Date.now() - cache.timestamp
	};
}

