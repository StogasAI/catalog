import { readBoundedResponseText } from './http';

const MAX_API_RESPONSE_BYTES = 8 * 1024 * 1024;
export const REQUEST_TIMEOUT_MS = 30_000;

export async function requestJson(input: string, init: RequestInit = {}): Promise<unknown> {
	const response = await fetch(input, {
		...init,
		redirect: 'error',
		signal: init.signal
			? AbortSignal.any([init.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
			: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
	});
	const text = await readBoundedResponseText(response, MAX_API_RESPONSE_BYTES);
	if (!response.ok) {
		let message = text;
		try {
			const payload: unknown = JSON.parse(text);
			if (isRecord(payload) && typeof payload.error === 'string') message = payload.error;
		} catch {
			// Preserve the response text when the server did not return JSON.
		}
		throw new Error(message || `Request failed with HTTP ${response.status}`);
	}
	try {
		return JSON.parse(text);
	} catch {
		throw new Error('Catalog editor API returned invalid JSON');
	}
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
