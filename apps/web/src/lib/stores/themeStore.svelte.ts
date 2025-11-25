// Theme state
let isDark = $state(false);

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

