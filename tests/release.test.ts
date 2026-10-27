import { createHash } from 'node:crypto';
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { describe, expect, spyOn, test } from 'bun:test';
import {
	canonicalJsonValue,
	checkCatalogArtifactSize,
	parseCatalogReleaseEvidence,
	resolveDestructiveOutput,
	sourceDigest,
	stagingDevelopmentProvenance
} from '../source/scripts/release-format.mjs';

describe('catalog release metadata', () => {
	test('publication runs no installation or check scripts', () => {
		const root = mkdtempSync(join(tmpdir(), 'stogas-catalog-publisher-'));
		try {
			// Skip the `.tmp-` paths of builds running in this checkout.
			cpSync('source', join(root, 'source'), {
				recursive: true,
				filter: (path) => !basename(path).includes('.tmp-')
			});
			writeFileSync(
				join(root, 'package.json'),
				JSON.stringify({
					name: 'catalog-publisher-fixture',
					scripts: { postinstall: 'node probe.mjs', check: 'node probe.mjs' }
				})
			);
			writeFileSync(
				join(root, 'probe.mjs'),
				"import {writeFileSync} from 'node:fs'; writeFileSync('executed-build-code', '');"
			);
			const result = Bun.spawnSync(
				[
					'node',
					'source/scripts/publish-release.mjs',
					'prepare-placeholder',
					'7',
					'release/catalog-v7'
				],
				{
					cwd: root,
					env: {
						...process.env,
						CATALOG_PUBLICATION_ENVIRONMENT: 'staging',
						CLOUDFLARE_ACCOUNT_ID: 'test-account',
						CLOUDFLARE_API_TOKEN: 'test-token',
						AWS_ACCESS_KEY_ID: 'test-access',
						AWS_SECRET_ACCESS_KEY: 'test-secret',
						AWS_BUCKET: 'test-bucket',
						AWS_REGION: 'us-east-1',
						R2_BUCKET: 'test-bucket'
					}
				}
			);
			// The isolated build was skipped, so publication stops at the missing artifacts before
			// any storage request.
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr.toString()).toContain('catalog.public.json');
			expect(existsSync(join(root, 'executed-build-code'))).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test('identifies committed source with the shared release digest', () => {
		const root = mkdtempSync(join(tmpdir(), 'stogas-catalog-source-'));
		const git = (...args: string[]) => {
			const result = Bun.spawnSync(['git', ...args], { cwd: root });
			if (result.exitCode !== 0) throw Error(result.stderr.toString());
			return result.stdout.toString().trim();
		};
		try {
			git('init', '-q');
			mkdirSync(join(root, 'dir'));
			writeFileSync(join(root, 'a'), 'first');
			writeFileSync(join(root, 'dir.txt'), '');
			writeFileSync(join(root, 'dir', 'z'), Buffer.from('payload\0\xff', 'latin1'));
			git('add', 'a', 'dir.txt', 'dir/z');
			git('update-index', '--chmod=+x', 'a');
			// The same value the verifier and gateway release tooling compute.
			expect(sourceDigest(root, git('write-tree'))).toBe(
				'887904a1ae03e4449f05e05fb147314cf9c8c428d3eec00179e0d7f56fc3a853'
			);
			git('update-index', '--chmod=-x', 'a');
			expect(sourceDigest(root, git('write-tree'))).not.toBe(
				'887904a1ae03e4449f05e05fb147314cf9c8c428d3eec00179e0d7f56fc3a853'
			);
			if (process.platform !== 'win32') {
				symlinkSync('a', join(root, 'link'));
				git('add', 'link');
				expect(() => sourceDigest(root, git('write-tree'))).toThrow('only regular files');
			}
		} finally {
			rmSync(root, { force: true, recursive: true });
		}
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
			artifacts: {
				'catalog.public.json': { sha256: '11'.repeat(32), size_bytes: 1 },
				'catalog.runtime.json': { sha256: '22'.repeat(32), size_bytes: 1 }
			}
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
							.update(`${canonicalJsonValue(manifest)}\n`)
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
				artifacts: {
					'catalog.public.json': { sha256: '11'.repeat(32), size_bytes: 1 },
					'catalog.runtime.json': { sha256: 'INVALID', size_bytes: 1 }
				}
			})
		).toThrow('valid runtime and public digests');
	});

	test('rejects artifacts over their limits and warns past three quarters of them', () => {
		const warn = spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const mib = 1024 * 1024;
			checkCatalogArtifactSize('catalog.public.json', 6 * mib);
			checkCatalogArtifactSize('catalog.runtime.json', 12 * mib);
			expect(warn).not.toHaveBeenCalled();
			checkCatalogArtifactSize('catalog.public.json', 6 * mib + 1);
			expect(warn.mock.calls[0]?.[0]).toContain(
				'catalog.public.json is 6291457 bytes, 75% of its 8 MiB limit.'
			);
			checkCatalogArtifactSize('catalog.runtime.json', 16 * mib);
			expect(warn.mock.calls[1]?.[0]).toContain('100% of its 16 MiB limit.');
			expect(() => checkCatalogArtifactSize('catalog.public.json', 8 * mib + 1)).toThrow(
				'the limit is 8388608'
			);
			expect(() => checkCatalogArtifactSize('catalog.runtime.json', 16 * mib + 1)).toThrow(
				'the limit is 16777216'
			);
			expect(() => checkCatalogArtifactSize('catalog.json', 1)).toThrow('not a catalog artifact');
			expect(warn).toHaveBeenCalledTimes(2);
		} finally {
			warn.mockRestore();
		}
	});

	test('builds one compact release over content-addressed artifacts', () => {
		const output = mkdtempSync(join(tmpdir(), 'stogas-catalog-release-'));
		try {
			const proofPath = join(output, 'attestation.json');
			const proof = { testAttestation: true };
			writeFileSync(proofPath, JSON.stringify(proof));
			const result = Bun.spawnSync(
				['node', 'source/scripts/create-release.mjs', '7', output, proofPath],
				{ cwd: process.cwd() }
			);
			expect(result.exitCode).toBe(0);

			// Control lists the approval in signed evidence, so only the artifacts are published.
			expect(readdirSync(output).sort()).toEqual(['SHA256SUMS', 'blobs', 'catalog-approval.json']);
			const envelopeBytes = readFileSync(join(output, 'catalog-approval.json'));
			expect(envelopeBytes.byteLength).toBeLessThanOrEqual(64 * 1024);
			const envelope = JSON.parse(envelopeBytes.toString());
			expect(Object.keys(envelope).sort()).toEqual(['document', 'provenance']);
			expect(envelope.provenance).toEqual(proof);
			expect(envelope.document.schema).toBe('stogas.catalog.release.v1');
			const { minimum_gateway_release } = JSON.parse(
				readFileSync('source/release-policy.json', 'utf8')
			);
			const [major, minor, patch] = minimum_gateway_release.slice(1).split('.').map(Number);
			expect(envelope.document.minimum_gateway_sequence).toBe(
				major * 1_000_000_000_000 + minor * 1_000_000 + patch
			);
			expect(envelope.document.sequence).toBe(7);
			expect(envelope.document.artifacts['catalog.runtime.json'].sha256).toMatch(/^[0-9a-f]{64}$/);
			expect(envelope.document.artifacts['catalog.public.json'].sha256).toMatch(/^[0-9a-f]{64}$/);
			for (const name of ['catalog.runtime.json', 'catalog.public.json']) {
				expect(envelope.document.artifacts[name].size_bytes).toBe(
					readFileSync(join('generated', name)).byteLength
				);
			}
			expect(readdirSync(join(output, 'blobs/sha256'))).toHaveLength(2);
			const source = envelope.document.source;
			const sized = (name: string, size_bytes: number) => ({
				...envelope,
				document: {
					...envelope.document,
					artifacts: {
						...envelope.document.artifacts,
						[name]: { ...envelope.document.artifacts[name], size_bytes }
					}
				}
			});
			parseCatalogReleaseEvidence(sized('catalog.public.json', 8 * 1024 * 1024));
			parseCatalogReleaseEvidence(sized('catalog.runtime.json', 16 * 1024 * 1024));
			for (const changed of [
				sized('catalog.public.json', 8 * 1024 * 1024 + 1),
				sized('catalog.runtime.json', 16 * 1024 * 1024 + 1),
				{ ...envelope, schema: 'extra' },
				{ ...envelope, signature: { key_id: 'key', signature: 'AA' } },
				{ ...envelope, provenance: [proof] },
				{ ...envelope, manifest: envelope.document },
				{ ...envelope, document: { ...envelope.document, extra: true } },
				{ ...envelope, document: { ...envelope.document, schema: 'stogas.catalog.release.v2' } },
				{
					...envelope,
					document: { ...envelope.document, source: { ...source, tree: source.commit } }
				},
				{
					...envelope,
					document: { ...envelope.document, source: { ...source, sha256: [source.sha256] } }
				}
			]) {
				expect(() => parseCatalogReleaseEvidence(changed)).toThrow();
			}
			const head = Bun.spawnSync(['git', 'rev-parse', 'HEAD']).stdout.toString().trim();
			expect(source).toEqual({
				commit: head,
				repository: 'https://github.com/StogasAI/catalog',
				sha256: sourceDigest(process.cwd(), head),
				tag: 'catalog-v7'
			});
		} finally {
			rmSync(output, { force: true, recursive: true });
		}
	});
});
