// Timeline Store - Tracks execution events for the Timeline tab

export interface TimelineEntry {
	nodeId: string;
	nodeName: string;
	nodeType: string;
	status: 'pending' | 'running' | 'success' | 'error' | 'cancelled' | 'suspended';
	startedAt?: number;
	completedAt?: number;
	durationMs?: number;
	// For Map nodes
	isMap?: boolean;
	mapTotal?: number;
	mapCompleted?: number;
	mapFailed?: number;
	// Error info
	error?: string;
}

// Current run tracking
let currentRunId = $state<string | null>(null);
let entries = $state<Map<string, TimelineEntry>>(new Map());
let runStartedAt = $state<number | null>(null);

// Clear timeline for new run
function startNewRun(runId: string) {
	currentRunId = runId;
	entries = new Map();
	runStartedAt = Date.now();
}

// Add or update an entry
function updateEntry(nodeId: string, update: Partial<TimelineEntry>) {
	const existing = entries.get(nodeId);
	const updated: TimelineEntry = {
		nodeId,
		nodeName: update.nodeName || existing?.nodeName || nodeId,
		nodeType: update.nodeType || existing?.nodeType || 'unknown',
		status: update.status || existing?.status || 'pending',
		...existing,
		...update,
	};
	
	// Calculate duration if completed
	if (updated.completedAt && updated.startedAt) {
		updated.durationMs = updated.completedAt - updated.startedAt;
	}
	
	entries = new Map(entries).set(nodeId, updated);
}

// Mark node as started
function nodeStarted(nodeId: string, nodeName: string, nodeType: string) {
	updateEntry(nodeId, {
		nodeName,
		nodeType,
		status: 'running',
		startedAt: Date.now(),
	});
}

// Mark node as completed
function nodeCompleted(nodeId: string, status: 'success' | 'error' | 'cancelled', error?: string) {
	updateEntry(nodeId, {
		status,
		completedAt: Date.now(),
		error,
	});
}

// Update map progress
function mapProgress(nodeId: string, completed: number, total: number, failed: number = 0) {
	updateEntry(nodeId, {
		isMap: true,
		mapCompleted: completed,
		mapTotal: total,
		mapFailed: failed,
		status: completed >= total ? 'success' : 'suspended',
		...(completed >= total && { completedAt: Date.now() }),
	});
}

// Get entries as sorted array (by start time)
const sortedEntries = $derived(() => {
	return Array.from(entries.values()).sort((a, b) => {
		const aTime = a.startedAt || 0;
		const bTime = b.startedAt || 0;
		return aTime - bTime;
	});
});

// Get total elapsed time
const elapsedMs = $derived(() => {
	if (!runStartedAt) return 0;
	const lastEntry = sortedEntries().find(e => e.completedAt);
	if (lastEntry?.completedAt) {
		return lastEntry.completedAt - runStartedAt;
	}
	return Date.now() - runStartedAt;
});

// Check if run is complete
const isComplete = $derived(() => {
	const all = sortedEntries();
	if (all.length === 0) return false;
	return all.every(e => e.status === 'success' || e.status === 'error' || e.status === 'cancelled');
});

// Clear timeline
function clear() {
	currentRunId = null;
	entries = new Map();
	runStartedAt = null;
}

export const timelineStore = {
	// Getters
	get currentRunId() { return currentRunId; },
	get entries() { return entries; },
	get sortedEntries() { return sortedEntries(); },
	get runStartedAt() { return runStartedAt; },
	get elapsedMs() { return elapsedMs(); },
	get isComplete() { return isComplete(); },
	
	// Actions
	startNewRun,
	updateEntry,
	nodeStarted,
	nodeCompleted,
	mapProgress,
	clear,
};

