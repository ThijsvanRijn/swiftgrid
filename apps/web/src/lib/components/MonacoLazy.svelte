<script lang="ts">
import { onMount, onDestroy } from 'svelte';
import { getMonaco, isMonacoReady } from '$lib/monaco';

const {
	value = '',
	language = 'json',
	readOnly = false,
	height = '360px',
	onChange = () => {}
} = $props<{
	value?: string;
	language?: string;
	readOnly?: boolean;
	height?: string;
	onChange?: (val: string) => void;
}>();

let container = $state<HTMLDivElement | null>(null);
let editor: any = null;
let monacoApi: typeof import('monaco-editor') | null = null;
let ready = $state(isMonacoReady());

onMount(async () => {
	if (typeof window === 'undefined' || !container) return;
	
	try {
		const monaco = await getMonaco();
		monacoApi = monaco;
		
		// Double-check container still exists after async
		if (!container) return;
		
		editor = monaco.editor.create(container, {
			value,
			language,
			readOnly,
			minimap: { enabled: false },
			automaticLayout: true,
			wordWrap: 'on',
			scrollBeyondLastLine: false,
			fontSize: 13,
			lineNumbers: 'on',
			theme: 'vs-dark'
		});
		
		editor.onDidChangeModelContent(() => {
			if (!readOnly) {
				const val = editor.getValue();
				onChange(val);
			}
		});
		
		ready = true;
	} catch (e) {
		console.error('Failed to load Monaco:', e);
	}
});

onDestroy(() => {
	if (editor) {
		editor.dispose();
		editor = null;
	}
});

$effect(() => {
	if (!editor) return;
	const nextVal = value ?? '';
	if (editor.getValue() !== nextVal) {
		const viewState = editor.saveViewState();
		editor.setValue(nextVal);
		if (viewState) editor.restoreViewState(viewState);
	}
});

$effect(() => {
	if (!editor) return;
	editor.updateOptions({ readOnly });
});

$effect(() => {
	if (!editor || !monacoApi) return;
	const model = editor.getModel();
	if (model) {
		monacoApi.editor.setModelLanguage(model, language);
	}
});
</script>

<div class="w-full monaco-container" style={`height:${height};`}>
	<div 
		bind:this={container} 
		class="h-full w-full"
		class:opacity-0={!ready}
		class:opacity-100={ready}
		style="transition: opacity 50ms ease-in;"
	></div>
</div>

<style>
	.monaco-container {
		background: #1e1e1e;
		contain: strict;
	}
</style>
