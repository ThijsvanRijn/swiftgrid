type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
	id: string;
	message: string;
	type: ToastType;
	duration?: number;
}

let toasts = $state<Toast[]>([]);

function generateId() {
	if (typeof crypto !== 'undefined' && crypto.randomUUID) {
		return crypto.randomUUID();
	}
	return Math.random().toString(36).slice(2);
}

function push(message: string, type: ToastType = 'info', duration = 3000) {
	const toast: Toast = { id: generateId(), message, type, duration };
	toasts = [...toasts, toast];
	if (duration > 0) {
		setTimeout(() => remove(toast.id), duration);
	}
	return toast.id;
}

function remove(id: string) {
	toasts = toasts.filter((t) => t.id !== id);
}

export const toastStore = {
	get toasts() {
		return toasts;
	},
	push,
	remove,
	success: (message: string, duration?: number) => push(message, 'success', duration ?? 2500),
	error: (message: string, duration?: number) => push(message, 'error', duration ?? 4000),
	warning: (message: string, duration?: number) => push(message, 'warning', duration ?? 3500),
	info: (message: string, duration?: number) => push(message, 'info', duration ?? 2500)
};


