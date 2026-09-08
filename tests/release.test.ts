import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
	catalogApprovalLedgerKey,
	resolveDestructiveOutput,
	stagingDevelopmentProvenance
} from '../source/scripts/release-format.mjs';
import {
	catalogSigningKeys,
	catalogVerificationKeys,
	verifyCatalogReleaseSignature
} from '../source/scripts/signing-keys.mjs';

describe('catalog release metadata', () => {
	test('separates signing keys and lets staging verify normal production releases', () => {
		const production = catalogSigningKeys('prod');
		const staging = catalogSigningKeys('staging');
		expect(Object.keys(production)).toEqual(['stogas-ed25519-stamp-v1']);
		expect(Object.keys(staging)).toEqual(['stogas-ed25519-staging-v1']);
		expect(Object.values(staging)).not.toEqual(Object.values(production));
		expect(catalogVerificationKeys('prod')).toEqual(production);
		expect(catalogVerificationKeys('staging')).toEqual({ ...production, ...staging });
		expect(() => catalogSigningKeys('local')).toThrow('must be staging or prod');
	});
	test('publishes approvals under the shared ledger path only', () => {
		expect(catalogApprovalLedgerKey('approvals/32.json')).toBe('ledger/v1/catalogs/32.json');
		expect(catalogApprovalLedgerKey('releases/32.json')).toBeNull();
		expect(catalogApprovalLedgerKey('approvals/0.json')).toBeNull();
	});

	test('restricts destructive release output paths', () => {
		const temporary = mkdtempSync(join(tmpdir(), 'stogas-catalog-output-'));
		const linked = join(temporary, 'linked');
		if (process.platform !== 'win32') symlinkSync(tmpdir(), linked, 'dir');
		try {
			expect(
				resolveDestructiveOutput(process.cwd(), temporary, {
					allowedRepositoryRoots: ['release'],
					defaultRelative: 'release'
				})
			).toBe(resolve(temporary));
			if (process.platform !== 'win32') {
				expect(() =>
					resolveDestructiveOutput(process.cwd(), linked, {
						allowedRepositoryRoots: ['release'],
						defaultRelative: 'release'
					})
				).toThrow('symbolic links');
			}
			expect(() =>
				resolveDestructiveOutput(process.cwd(), '/', {
					allowedRepositoryRoots: ['release'],
					defaultRelative: 'release'
				})
			).toThrow('approved');
		} finally {
			rmSync(temporary, { force: true, recursive: true });
		}
	});

	test('creates exact staging-only provenance for the catalog release manifest', () => {
		const manifest = {
			public: `sha256:${'11'.repeat(32)}`,
			runtime: `sha256:${'22'.repeat(32)}`
		};
		const statement = stagingDevelopmentProvenance(manifest);
		expect(statement).toEqual({
			_type: 'https://in-toto.io/Statement/v1',
			predicate: { environment: 'staging' },
			predicateType: 'https://stogas.ai/attestations/staging-development/v1',
			subject: [
				{
					digest: {
						sha256: createHash('sha256').update(canonicalJson(manifest)).digest('hex')
					},
					name: 'catalog-release.json'
				}
			]
		});
		expect(() =>
			stagingDevelopmentProvenance({
				public: `sha256:${'11'.repeat(32)}`,
				runtime: 'sha256:INVALID'
			})
		).toThrow('valid runtime and public digests');
	});

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
			const keys = {
				'test-key': publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
			};
			expect(() => verifyCatalogReleaseSignature(envelope, keys)).not.toThrow();
			for (const changed of [
				{ ...envelope, keyId: 'unknown-key' },
				{ ...envelope, signature: 'AA' },
				{ ...envelope, signature: envelope.signature + '==' },
				{ ...envelope, manifest: { ...envelope.manifest, sequence: 8 } }
			]) {
				expect(() => verifyCatalogReleaseSignature(changed, keys)).toThrow('signature is invalid');
			}
			expect(() =>
				verifyCatalogReleaseSignature(envelope, catalogVerificationKeys('prod'))
			).toThrow('key is not trusted');
			expect(envelope.manifest.schema).toBe('stogas.catalog.release.v1');
			expect(envelope.manifest.catalogSchema).toBe(1);
			expect(envelope.manifest.minimumGatewaySequence).toBe(1);
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
