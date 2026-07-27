import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

describe('catalog release metadata', () => {
	test('builds an unsigned reviewable draft from the compiled bytes', () => {
		const output = mkdtempSync(join(tmpdir(), 'stogas-catalog-draft-'));
		try {
			const result = Bun.spawnSync(['node', 'source/scripts/create-draft.mjs', '7', output], {
				cwd: process.cwd(),
				env: {
					...process.env,
					CATALOG_CHANNEL: 'canary',
					CATALOG_DRAFT_CREATED_AT: '2026-07-27T12:00:00Z',
					CATALOG_MIN_GATEWAY_VERSION: '1.2.3',
					CATALOG_SOURCE_COMMIT: 'a'.repeat(40)
				}
			});
			expect(result.exitCode).toBe(0);

			const draft = JSON.parse(readFileSync(join(output, 'catalog.draft.json'), 'utf8'));
			expect(draft).toMatchObject({
				schema: 'stogas.catalog.draft.v1',
				sequence: 7,
				channel: 'canary',
				minGatewayVersion: '1.2.3'
			});
			expect(draft).not.toHaveProperty('signature');
			for (const [key, filename] of [
				['runtime', 'catalog.runtime.json'],
				['public', 'catalog.public.json']
			] as const) {
				const bytes = readFileSync(join(output, filename));
				expect(draft[key].size).toBe(bytes.byteLength);
				expect(draft[key].digest).toMatch(/^sha256:[0-9a-f]{64}$/);
			}
		} finally {
			rmSync(output, { force: true, recursive: true });
		}
	});

	test('builds a bounded signed 30-day release over content-addressed artifacts', () => {
		const output = mkdtempSync(join(tmpdir(), 'stogas-catalog-release-'));
		const { privateKey, publicKey } = generateKeyPairSync('ed25519');
		try {
			const result = Bun.spawnSync(['node', 'source/scripts/create-release.mjs', '7', output], {
				cwd: process.cwd(),
				env: {
					...process.env,
					CATALOG_MIN_GATEWAY_VERSION: '1.2.3',
					CATALOG_SIGNING_KEY_ID: 'test-key',
					CATALOG_SIGNING_PRIVATE_KEY_PEM: privateKey
						.export({ format: 'pem', type: 'pkcs8' })
						.toString(),
					CATALOG_SOURCE_COMMIT: 'a'.repeat(40),
					CATALOG_SOURCE_TIMESTAMP: '2026-07-27T12:00:00Z'
				}
			});
			expect(result.exitCode).toBe(0);

			const envelopeBytes = readFileSync(join(output, 'releases/7.json'));
			expect(envelopeBytes.byteLength).toBeLessThanOrEqual(64 * 1024);
			const envelope = JSON.parse(envelopeBytes.toString());
			expect(envelope.schema).toBe('stogas.catalog.signed.v1');
			expect(envelope.manifest.sequence).toBe(7);
			expect(
				Date.parse(envelope.manifest.expiresAt) - Date.parse(envelope.manifest.createdAt)
			).toBe(30 * 24 * 60 * 60 * 1000);
			expect(envelope.manifest.runtime.path).toBe(
				`blobs/sha256/${envelope.manifest.runtime.digest.slice('sha256:'.length)}.json`
			);
			expect(envelope.manifest.public.path).toBe(
				`blobs/sha256/${envelope.manifest.public.digest.slice('sha256:'.length)}.json`
			);
			expect(
				verify(
					null,
					Buffer.from(stableJson(envelope.manifest)),
					publicKey,
					Buffer.from(envelope.signature.value, 'base64')
				)
			).toBe(true);
		} finally {
			rmSync(output, { force: true, recursive: true });
		}
	});
});

function stableJson(value: unknown) {
	return `${JSON.stringify(stableValue(value))}\n`;
}

function stableValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stableValue);
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, child]) => [key, stableValue(child)])
	);
}
