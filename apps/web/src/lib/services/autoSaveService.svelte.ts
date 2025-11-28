// Save status for UI feedback
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
let status = $state<SaveStatus>('idle');
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSavedHash = '';

const DEBOUNCE_MS = 1000; // Wait 1 second after last change

// We'll get flowStore lazily to avoid circular imports
let getFlowStore: () => typeof import('$lib/stores/flowStore.svelte').flowStore;

// Initialize the lazy getter (called once from flowStore)
function init(flowStoreGetter: typeof getFlowStore) {
    getFlowStore = flowStoreGetter;
}

// Creates a simple hash of the flow state to detect changes
function hashFlow(): string {
    const flowStore = getFlowStore();
    return JSON.stringify({
        nodes: flowStore.nodes.map(n => ({
            id: n.id,
            type: n.type,
            position: n.position,
            data: {
                // Common fields
                label: n.data.label,
                // HTTP node fields
                url: n.data.url,
                method: n.data.method,
                headers: n.data.headers,
                body: n.data.body,
                // Code node fields
                code: n.data.code,
                inputs: n.data.inputs,
                // Delay node fields
                delayMs: n.data.delayMs,
                delayStr: n.data.delayStr,
                // Webhook wait fields
                timeoutMs: n.data.timeoutMs,
                timeoutStr: n.data.timeoutStr,
                description: n.data.description,
                // Router node fields
                routeBy: n.data.routeBy,
                conditions: n.data.conditions,
                defaultOutput: n.data.defaultOutput,
                routerMode: n.data.routerMode,
                // LLM node fields
                baseUrl: n.data.baseUrl,
                apiKey: n.data.apiKey,
                model: n.data.model,
                systemPrompt: n.data.systemPrompt,
                userPrompt: n.data.userPrompt,
                temperature: n.data.temperature,
                maxTokens: n.data.maxTokens,
                stream: n.data.stream,
            }
        })),
        edges: flowStore.edges,
        viewport: flowStore.viewport
    });
}

// Performs the actual save
async function performSave() {
    if (!getFlowStore) return;
    
    const flowStore = getFlowStore();
    const currentHash = hashFlow();
    
    // Skip if nothing changed
    if (currentHash === lastSavedHash) {
        return;
    }

    status = 'saving';

    try {
        const response = await fetch('/api/flows', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                nodes: flowStore.nodes, 
                edges: flowStore.edges,
                viewport: flowStore.viewport,
                workflowId: flowStore.workflowId  // Pass existing ID to update instead of create
            })
        });

        if (response.ok) {
            lastSavedHash = currentHash;
            status = 'saved';
            
            // Reset to idle after 2 seconds
            setTimeout(() => {
                if (status === 'saved') status = 'idle';
            }, 2000);
        } else {
            status = 'error';
        }
    } catch (e) {
        console.error('Auto-save failed', e);
        status = 'error';
    }
}

// Triggers a debounced save
function triggerSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(performSave, DEBOUNCE_MS);
}

// Marks the current state as "already saved" (used after initial load)
function markAsSaved() {
    lastSavedHash = hashFlow();
    status = 'idle';
}

// Forces an immediate save (for manual save button)
async function saveNow() {
    if (saveTimer) clearTimeout(saveTimer);
    await performSave();
}

export const autoSaveService = {
    get status() { return status; },
    init,
    triggerSave,
    markAsSaved,
    saveNow
};

