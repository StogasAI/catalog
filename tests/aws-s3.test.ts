import { afterEach, describe, expect, test } from 'bun:test';
import { putS3Object } from '../source/scripts/aws-s3.mjs';
import { r2WriteConditionETag } from '../source/scripts/r2-etag.mjs';

const originalFetch = globalThis.fetch;
const originalEnvironment = {
	AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
	AWS_BUCKET: process.env.AWS_BUCKET,
	AWS_OBJECT_LOCK_ENABLED: process.env.AWS_OBJECT_LOCK_ENABLED,
	AWS_REGION: process.env.AWS_REGION,
	AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY
};

afterEach(() => {
	globalThis.fetch = originalFetch;
	for (const [name, value] of Object.entries(originalEnvironment)) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
});

describe('catalog S3 publication', () => {
	test('uses the strong R2 object validator for conditional writes', () => {
		expect(r2WriteConditionETag('W/"abc123"')).toBe('"abc123"');
		expect(r2WriteConditionETag('"abc123"')).toBe('"abc123"');
		expect(r2WriteConditionETag(null)).toBeNull();
	});

	test('locks immutable catalog objects for 100 years and leaves aliases unlocked', async () => {
		process.env.AWS_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
		process.env.AWS_BUCKET = 'stogas-catalog-test';
		delete process.env.AWS_OBJECT_LOCK_ENABLED;
		process.env.AWS_REGION = 'us-east-1';
		process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
		const requests: Request[] = [];
		globalThis.fetch = async (input, init) => {
			requests.push(new Request(input, init));
			return new Response(null, { headers: { etag: '"written"' } });
		};

		const startedAt = new Date();
		await putS3Object('catalog/releases/7.json', Buffer.from('{}'), {
			cacheControl: 'public, max-age=31536000, immutable',
			ifNoneMatch: '*',
			immutable: true
		});
		await putS3Object('catalog/latest.json', Buffer.from('{}'), {
			cacheControl: 'public, max-age=5, stale-while-revalidate=2, stale-if-error=0',
			ifNoneMatch: '*'
		});
		const completedAt = new Date();

		expect(requests).toHaveLength(2);
		expect(requests[0]!.headers.get('x-amz-object-lock-mode')).toBe('GOVERNANCE');
		expect(requests.every((request) => request.redirect === 'error')).toBe(true);
		const retainedUntil = new Date(
			requests[0]!.headers.get('x-amz-object-lock-retain-until-date')!
		);
		expect(retainedUntil.getTime()).toBeGreaterThanOrEqual(addUtcYears(startedAt, 100).getTime());
		expect(retainedUntil.getTime()).toBeLessThanOrEqual(addUtcYears(completedAt, 100).getTime());
		expect(requests[0]!.headers.get('x-amz-checksum-sha256')).toBeTruthy();
		expect(requests[1]!.headers.get('x-amz-object-lock-mode')).toBeNull();
		expect(requests[1]!.headers.get('cache-control')).toContain('stale-while-revalidate=2');
	});

	test('rejects unsafe S3 virtual-host configuration before sending credentials', async () => {
		process.env.AWS_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
		process.env.AWS_OBJECT_LOCK_ENABLED = 'false';
		process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
		let requests = 0;
		globalThis.fetch = async () => {
			requests += 1;
			return new Response(null);
		};

		for (const [bucket, region] of [
			['bucket.example@attacker.example', 'us-east-1'],
			['127.0.0.1', 'us-east-1'],
			['stogas-catalog-test', 'us-east-1.example']
		]) {
			process.env.AWS_BUCKET = bucket;
			process.env.AWS_REGION = region;
			await expect(putS3Object('catalog/latest.json', Buffer.from('{}'))).rejects.toThrow();
		}
		expect(requests).toBe(0);
	});

	test('leaves staging catalog objects resettable', async () => {
		process.env.AWS_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
		process.env.AWS_BUCKET = 'stogas-catalog-test';
		process.env.AWS_OBJECT_LOCK_ENABLED = 'false';
		process.env.AWS_REGION = 'us-east-1';
		process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
		let request: Request | undefined;
		globalThis.fetch = async (input, init) => {
			request = new Request(input, init);
			return new Response(null, { headers: { etag: '"written"' } });
		};

		await putS3Object('catalog/releases/7.json', Buffer.from('{}'), {
			cacheControl: 'public, max-age=31536000, immutable',
			ifNoneMatch: '*',
			immutable: true
		});

		expect(request?.headers.get('x-amz-object-lock-mode')).toBeNull();
		expect(request?.headers.get('x-amz-object-lock-retain-until-date')).toBeNull();
	});
});

function addUtcYears(value: Date, years: number) {
	const result = new Date(value);
	result.setUTCFullYear(result.getUTCFullYear() + years);
	return result;
}
