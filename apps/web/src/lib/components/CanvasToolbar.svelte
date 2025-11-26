<script lang="ts">
	// Canvas toolbar - lives inside the SvelteFlow canvas
</script>

<div class="bg-panel border border-panel-border rounded-none shadow-float flex items-center p-1 gap-0.5 pointer-events-auto self-start">
	<button class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-none bg-sidebar-accent text-foreground">
		<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<circle cx="12" cy="12" r="3"/>
			<path d="M3 12h3m12 0h3M12 3v3m0 12v3"/>
			<path d="m5.64 5.64 2.12 2.12m8.48 8.48 2.12 2.12M5.64 18.36l2.12-2.12m8.48-8.48 2.12-2.12"/>
		</svg>
		Workflow
	</button>
	<button class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-none text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors">
		<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M12 2v20M2 12h20"/>
			<path d="M12 2a10 10 0 0 1 0 20 10 10 0 0 1 0-20"/>
		</svg>
		Tree view
	</button>
	
	<!-- Separator -->
	<div class="w-px h-5 bg-border mx-1"></div>
	
	<!-- Icon buttons -->
	<button class="p-1.5 rounded-none text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors" title="Share">
		<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
			<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
		</svg>
	</button>
	<button class="p-1.5 rounded-none text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors" title="Duplicate">
		<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
			<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
		</svg>
	</button>
	<button class="p-1.5 rounded-none text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors" title="Documentation">
		<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>
		</svg>
	</button>
</div>

