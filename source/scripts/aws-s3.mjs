import { createHash, createHmac } from 'node:crypto';
import { readBoundedResponseBuffer, readBoundedResponseText } from './http.mjs';

const RETRYABLE_STATUS = new Set([409, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_OBJECT_BYTES = 128 * 1024 * 1024;
const MAX_ERROR_BYTES = 64 * 1024;
const CATALOG_RETENTION_YEARS = 100;

export async function getS3Object(key) {
	const response = await request('GET', key);
	// S3 intentionally returns 403 for an absent object when this least-privilege
	// publisher has GetObject but not ListBucket. Every subsequent creation is
	// conditional and followed by an exact authenticated readback, so treating
	// the ambiguous response as absent cannot overwrite an existing object.
	if (response.status === 403 || response.status === 404) {
		await response.body?.cancel().catch(() => {});
		return null;
	}
	if (!response.ok) {
		throw await responseError(response, `S3 GET ${key}`);
	}
	return { bytes: await readBoundedResponseBuffer(response, MAX_OBJECT_BYTES) };
}

/** Catalog objects never change, so production locks each one. */
export async function putS3Object(key, bytes, options = {}) {
	const headers = {
		'cache-control': options.cacheControl,
		'content-type': 'application/json',
		'if-none-match': options.ifNoneMatch,
		'x-amz-checksum-sha256': createHash('sha256').update(bytes).digest('base64'),
		'x-amz-sdk-checksum-algorithm': 'SHA256'
	};
	if (objectLockEnabled()) {
		headers['x-amz-object-lock-mode'] = 'GOVERNANCE';
		headers['x-amz-object-lock-retain-until-date'] = catalogRetentionUntil().toISOString();
	}
	const response = await request('PUT', key, bytes, headers);
	if (!response.ok) {
		throw await responseError(response, `S3 PUT ${key}`);
	}
	await response.body?.cancel().catch(() => {});
}

function catalogRetentionUntil(now = new Date()) {
	const value = new Date(now);
	value.setUTCFullYear(value.getUTCFullYear() + CATALOG_RETENTION_YEARS);
	return value;
}

function objectLockEnabled() {
	const configured = process.env.AWS_OBJECT_LOCK_ENABLED?.trim().toLowerCase();
	if (!configured || configured === 'true') return true;
	if (configured === 'false') return false;
	throw new Error('AWS_OBJECT_LOCK_ENABLED must be true or false');
}

async function request(method, key, body, extraHeaders = {}) {
	let lastError;
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			const signed = signedRequest(method, key, body, extraHeaders);
			const response = await fetch(signed.url, {
				body,
				headers: signed.headers,
				method,
				redirect: 'error',
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
			});
			if (response.redirected) {
				await response.body?.cancel();
				throw new Error(`AWS S3 ${method} ${key} redirected unexpectedly`);
			}
			if (!RETRYABLE_STATUS.has(response.status) || attempt === MAX_ATTEMPTS) {
				return response;
			}
			await response.body?.cancel();
			lastError = new Error(`AWS S3 returned retryable HTTP ${response.status}`);
		} catch (error) {
			lastError = error;
			if (attempt === MAX_ATTEMPTS) throw error;
		}
		await retryDelay(attempt);
	}
	throw lastError;
}

function signedRequest(method, key, body, extraHeaders) {
	const accessKeyId = requiredEnvironment('AWS_ACCESS_KEY_ID');
	const secretAccessKey = requiredEnvironment('AWS_SECRET_ACCESS_KEY');
	const region = validAwsRegion(requiredEnvironment('AWS_REGION'));
	const bucket = validS3Bucket(requiredEnvironment('AWS_BUCKET'));
	const sessionToken = process.env.AWS_SESSION_TOKEN?.trim();
	const now = new Date();
	const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
	const date = amzDate.slice(0, 8);
	const payloadHash = createHash('sha256')
		.update(body ?? '')
		.digest('hex');
	const host = `${bucket}.s3.${region}.amazonaws.com`;
	const canonicalUri = `/${key
		.split('/')
		.map((segment) => encodeURIComponent(segment))
		.join('/')}`;
	const headers = {
		host,
		'x-amz-content-sha256': payloadHash,
		'x-amz-date': amzDate,
		...definedHeaders(extraHeaders)
	};
	if (sessionToken) headers['x-amz-security-token'] = sessionToken;

	const headerNames = Object.keys(headers).sort();
	const canonicalHeaders = headerNames
		.map((name) => `${name}:${normalizeHeader(headers[name])}\n`)
		.join('');
	const signedHeaders = headerNames.join(';');
	const canonicalRequest = [
		method,
		canonicalUri,
		'',
		canonicalHeaders,
		signedHeaders,
		payloadHash
	].join('\n');
	const scope = `${date}/${region}/s3/aws4_request`;
	const stringToSign = [
		'AWS4-HMAC-SHA256',
		amzDate,
		scope,
		createHash('sha256').update(canonicalRequest).digest('hex')
	].join('\n');
	const dateKey = hmac(`AWS4${secretAccessKey}`, date);
	const regionKey = hmac(dateKey, region);
	const serviceKey = hmac(regionKey, 's3');
	const signingKey = hmac(serviceKey, 'aws4_request');
	const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

	headers.authorization =
		`AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
		`SignedHeaders=${signedHeaders}, Signature=${signature}`;
	return {
		headers,
		url: `https://${host}${canonicalUri}`
	};
}

function definedHeaders(headers) {
	return Object.fromEntries(
		Object.entries(headers).filter(([, value]) => value !== undefined && value !== null)
	);
}

function normalizeHeader(value) {
	return String(value).trim().replace(/\s+/g, ' ');
}

function hmac(key, value) {
	return createHmac('sha256', key).update(value).digest();
}

async function responseError(response, operation) {
	const body = await readBoundedResponseText(response, MAX_ERROR_BYTES).catch(() => '');
	const code = body.match(/<Code>([A-Za-z0-9]+)<\/Code>/)?.[1];
	return new Error(`${operation} failed (${response.status})${code ? ` (${code})` : ''}`);
}

function retryDelay(attempt) {
	return new Promise((resolve) => setTimeout(resolve, attempt * 100));
}

function requiredEnvironment(name) {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`${name} is required.`);
	return value;
}

function validAwsRegion(value) {
	if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value)) {
		throw new Error('AWS_REGION is invalid.');
	}
	return value;
}

function validS3Bucket(value) {
	if (
		value.length < 3 ||
		value.length > 63 ||
		!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/.test(value) ||
		value.includes('..') ||
		value.includes('.-') ||
		value.includes('-.') ||
		/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)
	) {
		throw new Error('AWS_BUCKET is not compatible with virtual-hosted S3 requests.');
	}
	return value;
}
