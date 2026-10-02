import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
	catalogApprovalLedgerKey,
	catalogManifest,
	resolveDestructiveOutput,
	stagingDevelopmentProvenance
} from '../source/scripts/release-format.mjs';
import {
	catalogSigningKeys,
	verifyCatalogReleaseSignature
} from '../source/scripts/signing-keys.mjs';

describe('catalog release metadata', () => {
	test('uses explicit current signing authorization without committed online keys', () => {
		const { publicKey } = signManifest({ test: true });
		const classicalKey = generateKeyPairSync('ed25519')
			.publicKey.export({ format: 'der', type: 'spki' })
			.toString('base64');
		for (const environment of ['staging', 'prod']) {
			expect(catalogSigningKeys(environment, JSON.stringify({ rotated_key: publicKey }))).toEqual({
				rotated_key: publicKey
			});
			for (const input of [
				undefined,
				'null',
				'[]',
				'{}',
				JSON.stringify({ a: publicKey, b: publicKey }),
				JSON.stringify({ a: classicalKey }),
				'{"a":"invalid"}'
			]) {
				expect(() => catalogSigningKeys(environment, input)).toThrow();
			}
		}
		expect(() => catalogSigningKeys('local', '{}')).toThrow('must be staging or prod');
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
						sha256: createHash('sha256')
							.update(`${canonicalJson(manifest)}\n`)
							.digest('hex')
					},
					name: 'catalog-release.json'
				},
				{ name: 'catalog.runtime.json', digest: { sha256: '22'.repeat(32) } },
				{ name: 'catalog.public.json', digest: { sha256: '11'.repeat(32) } }
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
		const { publicKey, signature } = signManifest(catalogManifest(process.cwd(), 7));
		try {
			const proofPath = join(output, 'attestation.json');
			const proof = { testAttestation: true };
			writeFileSync(proofPath, JSON.stringify(proof));
			const result = Bun.spawnSync(
				['node', 'source/scripts/create-release.mjs', '7', output, proofPath],
				{
					cwd: process.cwd(),
					env: {
						...process.env,
						CATALOG_SIGNATURE_JSON: JSON.stringify(signature),
						CATALOG_PUBLICATION_ENVIRONMENT: 'staging',
						CATALOG_AUTHORIZED_SIGNING_KEYS_JSON: JSON.stringify({ 'test-key': publicKey })
					}
				}
			);
			expect(result.exitCode).toBe(0);

			const envelopeBytes = readFileSync(join(output, 'releases/7.json'));
			expect(envelopeBytes.byteLength).toBeLessThanOrEqual(64 * 1024);
			const envelope = JSON.parse(envelopeBytes.toString());
			expect(Object.keys(envelope).sort()).toEqual([
				'attested_builds',
				'manifest',
				'schema',
				'signature'
			]);
			expect(envelope.schema).toBe('stogas.release-evidence.v1');
			expect(envelope.attested_builds).toEqual([proof]);
			expect(envelope.signature.key_id).toBe('test-key');
			const keys = {
				'test-key': publicKey
			};
			expect(() => verifyCatalogReleaseSignature(envelope, keys)).not.toThrow();
			for (const schema of [undefined, null, 1, '', 'stogas.release-evidence.v2']) {
				expect(() => verifyCatalogReleaseSignature({ ...envelope, schema }, keys)).toThrow(
					'evidence schema is unsupported'
				);
			}
			for (const changed of [
				{ ...envelope, signature: { ...envelope.signature, key_id: 'unknown-key' } },
				{ ...envelope, signature: { ...envelope.signature, signature: 'AA' } },
				{
					...envelope,
					signature: { ...envelope.signature, signature: envelope.signature.signature + '==' }
				},
				{ ...envelope, manifest: { ...envelope.manifest, sequence: 8 } }
			]) {
				expect(() => verifyCatalogReleaseSignature(changed, keys)).toThrow('signature is invalid');
			}
			expect(() => verifyCatalogReleaseSignature(envelope, {})).toThrow('key is not trusted');
			expect(envelope.manifest.schema).toBe('stogas.catalog.release.v1');
			expect(envelope.manifest.catalogSchema).toBe(1);
			expect(envelope.manifest.minimumGatewaySequence).toBe(1_000_005_000_052);
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
					Buffer.from(`stogas signed document v1\n${canonicalJson(envelope.manifest)}`),
					{ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' },
					Buffer.from(envelope.signature.signature, 'base64url')
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

// Node provides ML-DSA signing; Bun currently verifies it but cannot generate these keys.
function signManifest(manifest: unknown): {
	publicKey: string;
	signature: { key_id: string; signature: string };
} {
	const result = Bun.spawnSync(
		[
			'node',
			'--input-type=module',
			'-e',
			`
		import {generateKeyPairSync, sign} from 'node:crypto';
		import {readFileSync} from 'node:fs';
		const {privateKey, publicKey} = generateKeyPairSync('ml-dsa-65');
		const payload = Buffer.concat([Buffer.from('stogas signed document v1\\n'), readFileSync(0)]);
		process.stdout.write(JSON.stringify({
			publicKey: publicKey.export({format:'der', type:'spki'}).toString('base64'),
			signature: {key_id:'test-key', signature:sign(null, payload, privateKey).toString('base64url')}
		}));
	`
		],
		{ stdin: Buffer.from(canonicalJson(manifest)) }
	);
	if (result.exitCode !== 0) throw Error(result.stderr.toString());
	return JSON.parse(result.stdout.toString());
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
