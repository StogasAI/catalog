import { describe, expect, test } from 'bun:test';
import { ResponseBodyTooLargeError, readBoundedResponseBuffer } from '../source/scripts/http.mjs';

describe('bounded publication responses', () => {
	test('rejects and cancels an oversized declared response', async () => {
		let cancelled = false;
		const body = new ReadableStream<Uint8Array>({
			cancel() {
				cancelled = true;
			}
		});
		const response = new Response(body, { headers: { 'content-length': '9' } });

		await expect(readBoundedResponseBuffer(response, 8)).rejects.toBeInstanceOf(
			ResponseBodyTooLargeError
		);
		expect(cancelled).toBe(true);
	});

	test('bounds a streamed response when content length is absent', async () => {
		let cancelled = false;
		const response = new Response(
			new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new Uint8Array(5));
					controller.enqueue(new Uint8Array(5));
				},
				cancel() {
					cancelled = true;
				}
			})
		);

		await expect(readBoundedResponseBuffer(response, 8)).rejects.toBeInstanceOf(
			ResponseBodyTooLargeError
		);
		expect(cancelled).toBe(true);
	});
});
