// Sync initial state with what the inline script in app.html already set
// This prevents the flash where isDark starts false but the DOM already has .dark
function getInitialDark(): boolean {
	if (typeof document === 'undefined') return false;
	return document.documentElement.classList.contains('dark');
}

// Theme state - initialize from DOM to match inline script
let isDark = $state(getInitialDark());

// Toggle between light and dark
function toggle() {
	isDark = !isDark;
	apply();
}

// Apply theme to DOM and persist to localStorage
function apply() {
	const html = document.documentElement;
	if (isDark) {
		html.classList.add('dark');
		localStorage.setItem('theme', 'dark');
	} else {
		html.classList.remove('dark');
		localStorage.setItem('theme', 'light');
	}
}

// Load theme from localStorage or OS preference (call in onMount)
function init() {
	// Re-sync in case SSR rendered differently
	const stored = localStorage.getItem('theme');
	if (stored) {
		isDark = stored === 'dark';
	} else {
		isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
	}
	apply();
}

export const themeStore = {
	get isDark() { return isDark; },
	toggle,
	init
};

