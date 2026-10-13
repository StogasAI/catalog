import { createHash } from 'node:crypto';
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
	catalogApprovalLedgerKey,
	catalogManifest,
	canonicalJsonValue,
	parseCatalogReleaseEvidence,
	resolveDestructiveOutput,
	sourceDigest,
	stagingDevelopmentProvenance
} from '../source/scripts/release-format.mjs';

describe('catalog release metadata', () => {
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

			const envelopeBytes = readFileSync(join(output, 'releases/7.json'));
			expect(envelopeBytes.byteLength).toBeLessThanOrEqual(64 * 1024);
			const envelope = JSON.parse(envelopeBytes.toString());
			expect(Object.keys(envelope).sort()).toEqual(['document', 'provenance']);
			expect(envelope.provenance).toEqual(proof);
			expect(envelope.document.schema).toBe('stogas.catalog.release.v1');
			expect(envelope.document.minimum_gateway_sequence).toBe(1_000_005_000_061);
			expect(envelope.document.sequence).toBe(7);
			expect(envelope.document.artifacts['catalog.runtime.json'].sha256).toMatch(/^[0-9a-f]{64}$/);
			expect(envelope.document.artifacts['catalog.public.json'].sha256).toMatch(/^[0-9a-f]{64}$/);
			for (const name of ['catalog.runtime.json', 'catalog.public.json']) {
				expect(envelope.document.artifacts[name].size_bytes).toBe(
					readFileSync(join('generated', name)).byteLength
				);
			}
			const publicBytes = readFileSync(
				join(
					output,
					'blobs/sha256',
					`${envelope.document.artifacts['catalog.public.json'].sha256}.json`
				)
			);
			const archive = JSON.parse(publicBytes.toString()).archive;
			const archiveBytes = readFileSync(join(output, 'blobs/sha256', `${archive.sha256}.json`));
			expect(archiveBytes.byteLength).toBe(archive.size_bytes);
			expect(createHash('sha256').update(archiveBytes).digest('hex')).toBe(archive.sha256);
			expect(readdirSync(join(output, 'blobs/sha256'))).toHaveLength(3);
			const source = envelope.document.source;
			for (const changed of [
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
			expect(readFileSync(join(output, 'latest.json'))).toEqual(envelopeBytes);
		} finally {
			rmSync(output, { force: true, recursive: true });
		}
	});
});
