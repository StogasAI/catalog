export class ResponseBodyTooLargeError extends RangeError {
	constructor(maxBytes) {
		super(`Response body exceeds ${maxBytes} bytes`);
		this.name = 'ResponseBodyTooLargeError';
	}
}

export async function readBoundedResponseBuffer(response, maxBytes) {
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
		throw new RangeError('Response body limit must be a non-negative safe integer.');
	}
	const contentLength = response.headers.get('content-length');
	if (contentLength !== null && /^\d+$/.test(contentLength.trim())) {
		const declaredLength = Number(contentLength);
		if (!Number.isSafeInteger(declaredLength) || declaredLength > maxBytes) {
			await response.body?.cancel().catch(() => {});
			throw new ResponseBodyTooLargeError(maxBytes);
		}
	}
	if (!response.body) return Buffer.alloc(0);

	const reader = response.body.getReader();
	const chunks = [];
	let totalBytes = 0;
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			totalBytes += chunk.value.byteLength;
			if (totalBytes > maxBytes) {
				await reader.cancel().catch(() => {});
				throw new ResponseBodyTooLargeError(maxBytes);
			}
			chunks.push(chunk.value);
		}
	} finally {
		reader.releaseLock();
	}
	return Buffer.concat(chunks, totalBytes);
}

export async function readBoundedResponseText(response, maxBytes) {
	return (await readBoundedResponseBuffer(response, maxBytes)).toString('utf8');
}
