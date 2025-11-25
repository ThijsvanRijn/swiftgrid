// Secrets state
type SecretItem = { key: string; createdAt: string };

let secrets = $state<SecretItem[]>([]);
let keyInput = $state('');
let valueInput = $state('');

// Load all secret keys from the API (values are never exposed)
async function load() {
	const res = await fetch('/api/secrets');
	if (res.ok) secrets = await res.json();
}

// Save a new secret to the API
async function save() {
	if (!keyInput || !valueInput) return;

	const res = await fetch('/api/secrets', {
		method: 'POST',
		body: JSON.stringify({ key: keyInput, value: valueInput })
	});

	if (res.ok) {
		keyInput = '';
		valueInput = '';
		load();
		alert('Secret saved!');
	}
}

export const secretsStore = {
	get secrets() { return secrets; },
	get keyInput() { return keyInput; },
	set keyInput(v: string) { keyInput = v; },
	get valueInput() { return valueInput; },
	set valueInput(v: string) { valueInput = v; },

	load,
	save
};

