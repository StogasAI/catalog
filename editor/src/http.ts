export async function readBoundedResponseText(
	response: Response,
	maxBytes: number
): Promise<string> {
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
		throw new RangeError('Response limit must be a non-negative safe integer');
	}
	const contentLength = Number(response.headers.get('content-length'));
	if (Number.isFinite(contentLength) && contentLength > maxBytes) {
		await response.body?.cancel().catch(() => {});
		throw new Error(`Response exceeds ${maxBytes} bytes`);
	}
	if (!response.body) return '';

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let bytesRead = 0;
	const chunks: string[] = [];
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) return chunks.join('') + decoder.decode();
			bytesRead += value.byteLength;
			if (bytesRead > maxBytes) {
				await reader.cancel().catch(() => {});
				throw new Error(`Response exceeds ${maxBytes} bytes`);
			}
			chunks.push(decoder.decode(value, { stream: true }));
		}
	} finally {
		reader.releaseLock();
	}
}
