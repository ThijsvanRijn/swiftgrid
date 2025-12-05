import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	optimizeDeps: {
		include: ['bits-ui', 'motion']
	},
	ssr: {
		// Ensure bits-ui Svelte components are processed correctly during SSR
		noExternal: ['bits-ui']
	}
});
