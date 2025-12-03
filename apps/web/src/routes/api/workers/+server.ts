import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import Redis from 'ioredis';

// Worker status from Rust heartbeat
interface WorkerStatus {
	worker_id: string;
	status: 'healthy' | 'unhealthy' | 'dead';
	memory_mb: number;
	jobs_processed: number;
	current_jobs: number;
	uptime_secs: number;
	last_seen: string;
}

interface WorkersResponse {
	workers: WorkerStatus[];
	queue: {
		pending: number;
		stream_length: number;
	};
	totals: {
		jobs_processed: number;
		active_jobs: number;
		throughput_per_min: number;
	};
}

const STALE_THRESHOLD_MS = 15_000; // 15 seconds = unhealthy
const DEAD_THRESHOLD_MS = 60_000;  // 60 seconds = dead

export const GET: RequestHandler = async () => {
	const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
	
	try {
		// Get all workers from the hash
		const workersHash = await redis.hgetall('swiftgrid:workers');
		
		// Get queue depth (stream length)
		const streamLength = await redis.xlen('swiftgrid_stream');
		
		// Get pending count from consumer group
		let pendingCount = 0;
		try {
			const groupInfo = await redis.xpending('swiftgrid_stream', 'workers_group');
			if (Array.isArray(groupInfo) && groupInfo.length > 0) {
				pendingCount = typeof groupInfo[0] === 'number' ? groupInfo[0] : 0;
			}
		} catch {
			// Group might not exist yet
		}
		
		const now = Date.now();
		const workers: WorkerStatus[] = [];
		const deadWorkerIds: string[] = [];
		
		for (const [workerId, statusJson] of Object.entries(workersHash)) {
			try {
				const status = JSON.parse(statusJson) as WorkerStatus;
				const lastSeenTime = new Date(status.last_seen).getTime();
				const age = now - lastSeenTime;
				
				// Determine health status based on last_seen
				if (age > DEAD_THRESHOLD_MS) {
					// Worker is dead - mark for cleanup
					deadWorkerIds.push(workerId);
					status.status = 'dead';
				} else if (age > STALE_THRESHOLD_MS) {
					status.status = 'unhealthy';
				} else {
					status.status = 'healthy';
				}
				
				workers.push(status);
			} catch (e) {
				console.error(`Failed to parse worker status for ${workerId}:`, e);
			}
		}
		
		// Clean up dead workers (older than 60s)
		if (deadWorkerIds.length > 0) {
			await redis.hdel('swiftgrid:workers', ...deadWorkerIds);
		}
		
		// Filter out dead workers from response
		const aliveWorkers = workers.filter(w => w.status !== 'dead');
		
		// Sort by worker_id for consistent ordering
		aliveWorkers.sort((a, b) => a.worker_id.localeCompare(b.worker_id));
		
		// Calculate totals
		const totalJobsProcessed = aliveWorkers.reduce((sum, w) => sum + w.jobs_processed, 0);
		const totalActiveJobs = aliveWorkers.reduce((sum, w) => sum + w.current_jobs, 0);
		
		// Estimate throughput (jobs per minute based on uptime)
		const avgUptime = aliveWorkers.length > 0 
			? aliveWorkers.reduce((sum, w) => sum + w.uptime_secs, 0) / aliveWorkers.length 
			: 0;
		const throughputPerMin = avgUptime > 0 
			? Math.round((totalJobsProcessed / avgUptime) * 60) 
			: 0;
		
		const response: WorkersResponse = {
			workers: aliveWorkers,
			queue: {
				pending: pendingCount,
				stream_length: streamLength,
			},
			totals: {
				jobs_processed: totalJobsProcessed,
				active_jobs: totalActiveJobs,
				throughput_per_min: throughputPerMin,
			},
		};
		
		return json(response);
	} catch (error) {
		console.error('Failed to fetch workers:', error);
		return json({ workers: [], queue: { pending: 0, stream_length: 0 }, totals: { jobs_processed: 0, active_jobs: 0, throughput_per_min: 0 } });
	} finally {
		await redis.quit();
	}
};

