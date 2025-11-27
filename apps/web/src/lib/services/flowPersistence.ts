import { flowStore } from '$lib/stores/flowStore.svelte';
import { autoSaveService } from './autoSaveService.svelte';

// Manual save (uses auto-save service for immediate save)
export async function saveFlow() {
	await autoSaveService.saveNow();
}

// Callback for when we need fitView (no saved viewport)
let onNeedFitView: (() => void) | null = null;

export function setFitViewCallback(callback: () => void) {
	onNeedFitView = callback;
}

// Load the latest flow from the database
export async function loadLatestFlow() {
	try {
		const response = await fetch('/api/flows');
		const data = await response.json();

		if (data.graph) {
			const graph = data.graph as any;
			const hasViewport = graph.viewport && (graph.viewport.x !== 0 || graph.viewport.y !== 0 || graph.viewport.zoom !== 1);
			
			// Pass the workflow ID and name to the store
			flowStore.setFlow(graph.nodes || [], graph.edges || [], graph.viewport, data.id, data.name);
			console.log('Flow loaded from DB! (id:', data.id, ', name:', data.name, ')');
			
			// If no meaningful viewport was saved, trigger fitView
			if (!hasViewport && onNeedFitView) {
				// Small delay to let SvelteFlow render the nodes first
				setTimeout(() => onNeedFitView?.(), 50);
			}
		}

		// Mark current state as saved (so we don't immediately re-save)
		autoSaveService.markAsSaved();
	} catch (e) {
		console.error('Load failed', e);
	}
}

