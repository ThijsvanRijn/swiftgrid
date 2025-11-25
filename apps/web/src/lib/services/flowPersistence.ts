import { flowStore } from '$lib/stores/flowStore.svelte';
import { autoSaveService } from './autoSaveService.svelte';

// Manual save (uses auto-save service for immediate save)
export async function saveFlow() {
	await autoSaveService.saveNow();
}

// Load the latest flow from the database
export async function loadLatestFlow() {
	try {
		const response = await fetch('/api/flows');
		const data = await response.json();

		if (data.graph) {
			const graph = data.graph as any;
			flowStore.setFlow(graph.nodes || [], graph.edges || []);
			console.log('Flow loaded from DB!');
		}

		// Mark current state as saved (so we don't immediately re-save)
		autoSaveService.markAsSaved();
	} catch (e) {
		console.error('Load failed', e);
	}
}

