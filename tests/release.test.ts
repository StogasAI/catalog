import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

describe('catalog release metadata', () => {
	test('builds one compact authorization over content-addressed artifacts', () => {
		const output = mkdtempSync(join(tmpdir(), 'stogas-catalog-release-'));
		const { privateKey, publicKey } = generateKeyPairSync('ed25519');
		try {
			const result = Bun.spawnSync(['node', 'source/scripts/create-release.mjs', '7', output], {
				cwd: process.cwd(),
				env: {
					...process.env,
					CATALOG_SIGNING_KEY_ID: 'test-key',
					CATALOG_SIGNING_PRIVATE_KEY_PEM: privateKey
						.export({ format: 'pem', type: 'pkcs8' })
						.toString()
				}
			});
			expect(result.exitCode).toBe(0);

			const envelopeBytes = readFileSync(join(output, 'releases/7.json'));
			expect(envelopeBytes.byteLength).toBeLessThanOrEqual(64 * 1024);
			const envelope = JSON.parse(envelopeBytes.toString());
			expect(envelope.schema).toBe('stogas.catalog.signed.v1');
			expect(envelope.keyId).toBe('test-key');
			expect(envelope.manifest.schema).toBe('stogas.catalog.release.v1');
			expect(envelope.manifest.catalogSchema).toBe(1);
			expect(envelope.manifest.sequence).toBe(7);
			expect(envelope.manifest.runtime).toMatch(/^sha256:[0-9a-f]{64}$/);
			expect(envelope.manifest.public).toMatch(/^sha256:[0-9a-f]{64}$/);
			expect(envelope.manifest.source).toMatchObject({
				repository: 'https://github.com/StogasAI/catalog',
				tag: 'catalog-v7'
			});
			expect(readFileSync(join(output, 'latest.json'))).toEqual(envelopeBytes);
			expect(
				verify(
					null,
					Buffer.from(`stogas catalog release v1\n${canonicalJson(envelope.manifest)}`),
					publicKey,
					Buffer.from(envelope.signature, 'base64url')
				)
			).toBe(true);
		} finally {
			rmSync(output, { force: true, recursive: true });
		}
	});
});

function canonicalJson(value: unknown) {
	return JSON.stringify(stableValue(value));
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
