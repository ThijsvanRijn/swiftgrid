// Global Monaco preloader - import this early in your app to warm up Monaco
import type * as Monaco from 'monaco-editor';

let monacoInstance: typeof Monaco | null = null;
let monacoPromise: Promise<typeof Monaco> | null = null;

// Preload workers immediately when this module is imported
let workersReady = false;

async function setupWorkers() {
	if (workersReady || typeof window === 'undefined') return;
	
	const [
		{ default: editorWorker },
		{ default: jsonWorker },
		{ default: cssWorker },
		{ default: htmlWorker },
		{ default: tsWorker }
	] = await Promise.all([
		import('monaco-editor/esm/vs/editor/editor.worker?worker'),
		import('monaco-editor/esm/vs/language/json/json.worker?worker'),
		import('monaco-editor/esm/vs/language/css/css.worker?worker'),
		import('monaco-editor/esm/vs/language/html/html.worker?worker'),
		import('monaco-editor/esm/vs/language/typescript/ts.worker?worker')
	]);

	// @ts-ignore
	self.MonacoEnvironment = {
		getWorker(_: unknown, label: string) {
			if (label === 'json') {
				return new jsonWorker();
			}
			if (label === 'css' || label === 'scss' || label === 'less') {
				return new cssWorker();
			}
			if (label === 'html' || label === 'handlebars' || label === 'razor') {
				return new htmlWorker();
			}
			if (label === 'typescript' || label === 'javascript') {
				return new tsWorker();
			}
			return new editorWorker();
		}
	};
	
	workersReady = true;
}

export async function getMonaco(): Promise<typeof Monaco> {
	if (monacoInstance) return monacoInstance;
	
	if (!monacoPromise) {
		monacoPromise = (async () => {
			await setupWorkers();
			const monaco = await import('monaco-editor');
			monacoInstance = monaco;
			return monaco;
		})();
	}
	
	return monacoPromise;
}

// Start preloading immediately when this module is imported (browser only)
if (typeof window !== 'undefined') {
	// Use requestIdleCallback to preload during idle time, or setTimeout as fallback
	const preload = () => {
		getMonaco().catch(() => {
			// Silently fail - will retry when actually needed
		});
	};
	
	if ('requestIdleCallback' in window) {
		(window as any).requestIdleCallback(preload, { timeout: 2000 });
	} else {
		setTimeout(preload, 100);
	}
}

export function isMonacoReady(): boolean {
	return monacoInstance !== null;
}

