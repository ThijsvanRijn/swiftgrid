import { flowStore } from '$lib/stores/flowStore.svelte';

// Save current flow to the database
export async function saveFlow() {
	try {
		const response = await fetch('/api/flows', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ nodes: flowStore.nodes, edges: flowStore.edges })
		});

		if (response.ok) {
			// Visual feedback (could be a toast later)
			const btn = document.getElementById('saveBtn');
			if (btn) {
				const originalText = btn.innerText;
				btn.innerText = 'Saved!';
				setTimeout(() => (btn.innerText = originalText), 2000);
			}
		}
	} catch (e) {
		console.error('Save failed', e);
		alert('Failed to save flow to DB');
	}
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
	} catch (e) {
		console.error('Load failed', e);
	}
}

