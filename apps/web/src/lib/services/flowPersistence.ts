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
			
			// Extract version info
			const versionId = data.activeVersion?.id ?? null;
			const versionNumber = data.activeVersion?.versionNumber ?? null;
			
			// Pass the workflow ID, name, and version info to the store
			flowStore.setFlow(
				graph.nodes || [], 
				graph.edges || [], 
				graph.viewport, 
				data.id, 
				data.name,
				versionId,
				versionNumber
			);
			console.log('Flow loaded from DB! (id:', data.id, ', name:', data.name, ', version:', versionNumber ?? 'unpublished', ')');
			
			// If no meaningful viewport was saved, trigger fitView
			if (!hasViewport && onNeedFitView) {
				// Small delay to let SvelteFlow render the nodes first
				setTimeout(() => onNeedFitView?.(), 50);
			}
			
			// Check for active runs and restore node statuses
			if (data.id) {
				await restoreActiveRunState(data.id);
			}
		}

		// Mark current state as saved (so we don't immediately re-save)
		autoSaveService.markAsSaved();
	} catch (e) {
		console.error('Load failed', e);
	}
}

// Restore node statuses from any active run (after page refresh)
async function restoreActiveRunState(workflowId: number) {
	try {
		const response = await fetch(`/api/runs/active?workflowId=${workflowId}`);
		const data = await response.json();
		
		if (data.activeRun && data.nodeStatuses) {
			const statusCount = Object.keys(data.nodeStatuses).length;
			console.log(`🔄 Reconnecting to active run ${data.activeRun.id.slice(0, 8)}... (${statusCount} nodes)`);
			
			// Apply node statuses from the active run
			for (const [nodeId, statusInfo] of Object.entries(data.nodeStatuses)) {
				const info = statusInfo as { status: string; result?: any };
				
				// Map 'suspended' to a visual state (treat as running with special styling)
				const visualStatus = info.status === 'suspended' ? 'running' : info.status;
				
				flowStore.updateNodeStatus(
					nodeId, 
					visualStatus as 'idle' | 'running' | 'success' | 'error',
					info.result?.body ?? info.result
				);
			}
			
			console.log(`✓ Restored run state - ${data.activeRun.status} run continues in background`);
		}
	} catch (e) {
		console.error('Failed to restore active run state:', e);
	}
}

// Publish the current workflow as a new version
export async function publishFlow(changeSummary?: string): Promise<{ versionId: string; versionNumber: number } | null> {
	const workflowId = flowStore.workflowId;
	if (!workflowId) {
		console.error('Cannot publish: no workflow ID');
		return null;
	}
	
	try {
		const response = await fetch(`/api/flows/${workflowId}/publish`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ changeSummary })
		});
		
		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.error || 'Failed to publish');
		}
		
		const result = await response.json();
		
		// Update the store with new version info
		flowStore.setVersionInfo(result.versionId, result.versionNumber);
		
		console.log(`Published as version ${result.versionNumber}`);
		return result;
	} catch (e) {
		console.error('Publish failed:', e);
		return null;
	}
}

