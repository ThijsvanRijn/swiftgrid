// Console Panel Store - Execution Console state management

export type ConsoleTab = 'output' | 'timeline' | 'workers';

// Panel state
let isPanelOpen = $state(true);
let panelHeight = $state(280);
let activeTab = $state<ConsoleTab>('output');
let isResizing = $state(false);

// Min/max constraints
const MIN_HEIGHT = 150;
const MAX_HEIGHT = 600;
const DEFAULT_HEIGHT = 280;

// Panel actions
function togglePanel() {
	isPanelOpen = !isPanelOpen;
}

function openPanel() {
	isPanelOpen = true;
}

function closePanel() {
	isPanelOpen = false;
}

function setTab(tab: ConsoleTab) {
	activeTab = tab;
	// Auto-open panel when selecting a tab
	if (!isPanelOpen) {
		isPanelOpen = true;
	}
}

function setHeight(height: number) {
	panelHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, height));
}

function startResize() {
	isResizing = true;
}

function stopResize() {
	isResizing = false;
}

function resetHeight() {
	panelHeight = DEFAULT_HEIGHT;
}

// Export as a single store object
export const consoleStore = {
	// Getters (reactive)
	get isPanelOpen() { return isPanelOpen; },
	get panelHeight() { return panelHeight; },
	get activeTab() { return activeTab; },
	get isResizing() { return isResizing; },
	
	// Constants
	MIN_HEIGHT,
	MAX_HEIGHT,
	DEFAULT_HEIGHT,
	
	// Actions
	togglePanel,
	openPanel,
	closePanel,
	setTab,
	setHeight,
	startResize,
	stopResize,
	resetHeight,
};

