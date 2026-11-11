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
import { describe, expect, test } from 'bun:test';
import {
	canonicalJsonValue,
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
			expect(result.stderr.toString()).toContain('catalog.json');
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
		const manifest = { artifacts: { 'catalog.json': { sha256: '11'.repeat(32), size_bytes: 1 } } };
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
				{ name: 'catalog.json', digest: { sha256: '11'.repeat(32) } }
			]
		});
		expect(() =>
			stagingDevelopmentProvenance({
				artifacts: { 'catalog.json': { sha256: 'INVALID', size_bytes: 1 } }
			})
		).toThrow('valid root digest');
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

			// Control lists the approval in signed evidence, so only the root and the parts that it
			// names are published.
			expect(readdirSync(output).sort()).toEqual(['SHA256SUMS', 'blobs', 'catalog-approval.json']);
			const envelopeBytes = readFileSync(join(output, 'catalog-approval.json'));
			expect(envelopeBytes.byteLength).toBeLessThanOrEqual(64 * 1024);
			const envelope = JSON.parse(envelopeBytes.toString());
			expect(Object.keys(envelope).sort()).toEqual(['document', 'provenance']);
			expect(envelope.provenance).toEqual(proof);
			expect(envelope.document.schema).toBe('stogas.catalog.release.v2');
			const { minimum_gateway_release } = JSON.parse(
				readFileSync('source/release-policy.json', 'utf8')
			);
			const [major, minor, patch] = minimum_gateway_release.slice(1).split('.').map(Number);
			expect(envelope.document.minimum_gateway_sequence).toBe(
				major * 1_000_000_000_000 + minor * 1_000_000 + patch
			);
			expect(envelope.document.sequence).toBe(7);
			const rootBytes = readFileSync('generated/catalog.json');
			expect(Object.keys(envelope.document.artifacts)).toEqual(['catalog.json']);
			expect(envelope.document.artifacts['catalog.json']).toEqual({
				sha256: createHash('sha256').update(rootBytes).digest('hex'),
				size_bytes: rootBytes.byteLength
			});
			const root = JSON.parse(rootBytes.toString());
			expect(root.parts.length).toBeGreaterThan(0);
			const blobs = [
				envelope.document.artifacts['catalog.json'].sha256,
				...root.parts.map(({ sha256 }: { sha256: string }) => sha256)
			];
			expect(readdirSync(join(output, 'blobs/sha256')).sort()).toEqual(
				blobs.map((digest) => `${digest}.json`).sort()
			);
			expect(readFileSync(join(output, 'SHA256SUMS'), 'utf8').trim().split('\n')).toHaveLength(
				blobs.length + 1
			);
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
			parseCatalogReleaseEvidence(sized('catalog.json', 16 * 1024 * 1024));
			for (const changed of [
				sized('catalog.json', 16 * 1024 * 1024 + 1),
				sized('catalog.json', 0),
				{
					...envelope,
					document: {
						...envelope.document,
						artifacts: { ...envelope.document.artifacts, 'catalog.runtime.json': {} }
					}
				},
				{ ...envelope, schema: 'extra' },
				{ ...envelope, signature: { key_id: 'key', signature: 'AA' } },
				{ ...envelope, provenance: [proof] },
				{ ...envelope, manifest: envelope.document },
				{ ...envelope, document: { ...envelope.document, extra: true } },
				{ ...envelope, document: { ...envelope.document, schema: 'stogas.catalog.release.v1' } },
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

describe('catalog release repair', () => {
	// Every request goes to in-memory R2 and S3, which record the objects they hold on exit.
	const fakeStores = `
import { writeFileSync } from 'node:fs';
const objects = new Map();
globalThis.fetch = async (input, init = {}) => {
	const url = new URL(input);
	if (url.hostname === 'api.cloudflare.com')
		return Response.json({ success: true, result: { id: 'test-key', status: 'active' } });
	const key = url.hostname.split('.').slice(1, 3).join('.') + ':' + url.pathname;
	if (init.method === 'PUT') {
		if (objects.has(key)) return new Response(null, { status: 412 });
		objects.set(key, Buffer.from(init.body));
		return new Response(null, { status: 200 });
	}
	return objects.has(key) ? new Response(objects.get(key)) : new Response(null, { status: 404 });
};
process.on('exit', () => writeFileSync('stored.json', JSON.stringify([...objects.keys()].sort())));
`;
	const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

	/** A copy of the scripts and a release of the checkout's catalog, as sequence 7. */
	function fixture() {
		const root = mkdtempSync(join(tmpdir(), 'stogas-catalog-repair-'));
		cpSync('source', join(root, 'source'), {
			recursive: true,
			filter: (path) => !basename(path).includes('.tmp-')
		});
		writeFileSync(join(root, 'fake-stores.mjs'), fakeStores);
		const proofPath = join(root, 'attestation.json');
		writeFileSync(proofPath, JSON.stringify({ testAttestation: true }));
		const release = join(root, 'release/catalog-v7');
		const created = Bun.spawnSync(
			['node', 'source/scripts/create-release.mjs', '7', release, proofPath],
			{ cwd: process.cwd() }
		);
		expect(created.exitCode).toBe(0);
		return { root, release, blobs: join(release, 'blobs/sha256') };
	}

	function writeSums(release: string) {
		const files = [
			'catalog-approval.json',
			...readdirSync(join(release, 'blobs/sha256')).map((name) => `blobs/sha256/${name}`)
		];
		writeFileSync(
			join(release, 'SHA256SUMS'),
			files.map((file) => `${digest(readFileSync(join(release, file)))}  ${file}`).join('\n') + '\n'
		);
	}

	/**
	 * Changes the release's root as `change` says and approves the changed root in its place.
	 * Returns the root.
	 */
	function rooted(release: string, change: (root: { parts: object[] }) => void) {
		const approval = JSON.parse(readFileSync(join(release, 'catalog-approval.json'), 'utf8'));
		const artifact = approval.document.artifacts['catalog.json'];
		const blobs = join(release, 'blobs/sha256');
		const root = JSON.parse(readFileSync(join(blobs, `${artifact.sha256}.json`), 'utf8'));
		change(root);
		rmSync(join(blobs, `${artifact.sha256}.json`));
		const bytes = Buffer.from(JSON.stringify(root));
		writeFileSync(join(blobs, `${digest(bytes)}.json`), bytes);
		approval.document.artifacts['catalog.json'] = {
			sha256: digest(bytes),
			size_bytes: bytes.byteLength
		};
		writeFileSync(join(release, 'catalog-approval.json'), JSON.stringify(approval));
		writeSums(release);
		return root;
	}

	/** Names one more part in the release's root, as a build does, and returns its name. */
	function withPart(release: string) {
		const bytes = Buffer.from(JSON.stringify({ schema: 'stogas.catalog.part.v15', graph: {} }));
		writeFileSync(join(release, 'blobs/sha256', `${digest(bytes)}.json`), bytes);
		rooted(release, (root) =>
			root.parts.push({
				sha256: digest(bytes),
				size: bytes.byteLength,
				through: null,
				stogasSupported: true
			})
		);
		return `${digest(bytes)}.json`;
	}

	function repair(root: string) {
		const result = Bun.spawnSync(
			[
				'node',
				'--import',
				'./fake-stores.mjs',
				'source/scripts/publish-release.mjs',
				'repair',
				'7',
				'release/catalog-v7'
			],
			{
				cwd: root,
				env: {
					PATH: process.env.PATH,
					CATALOG_PUBLICATION_ENVIRONMENT: 'staging',
					CLOUDFLARE_ACCOUNT_ID: '0'.repeat(32),
					CLOUDFLARE_API_TOKEN: 'test-token',
					AWS_ACCESS_KEY_ID: 'test-access',
					AWS_SECRET_ACCESS_KEY: 'test-secret',
					AWS_BUCKET: 'test-bucket',
					AWS_REGION: 'us-east-1',
					R2_BUCKET: 'test-bucket'
				}
			}
		);
		const stored: string[] = JSON.parse(readFileSync(join(root, 'stored.json'), 'utf8'));
		return { exitCode: result.exitCode, stderr: result.stderr.toString(), stored };
	}

	/** The keys that both stores hold for these blobs. */
	function keys(blobs: string) {
		const names = readdirSync(blobs).sort();
		return [
			...names.map((name) => `r2.cloudflarestorage:/test-bucket/catalog/blobs/sha256/${name}`),
			...names.map((name) => `s3.us-east-1:/catalog/blobs/sha256/${name}`)
		].sort();
	}

	test('publishes exactly the blobs that a release names', () => {
		const { parts } = JSON.parse(readFileSync('generated/catalog.json', 'utf8'));
		for (const [added, count] of [
			[false, 1 + parts.length],
			[true, 2 + parts.length]
		] as const) {
			const { root, release, blobs } = fixture();
			try {
				if (added) withPart(release);
				const result = repair(root);
				expect(result.stderr).toBe('');
				expect(result.exitCode).toBe(0);
				expect(result.stored).toEqual(keys(blobs));
				expect(result.stored).toHaveLength(2 * count);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		}
	});

	test('publishes nothing when the blobs differ from what the release names', () => {
		const cases: [string, (release: string, blobs: string) => void, string][] = [
			[
				'an unlisted blob',
				(release, blobs) => {
					writeFileSync(join(blobs, `${'0'.repeat(64)}.json`), '{}');
					writeSums(release);
				},
				'exactly the root'
			],
			[
				'a missing part',
				(release, blobs) => {
					rmSync(join(blobs, withPart(release)));
					writeSums(release);
				},
				'exactly the root'
			],
			[
				'a changed part',
				(release, blobs) => {
					writeFileSync(join(blobs, withPart(release)), '{}');
					writeSums(release);
				},
				'differs from its approved digest'
			],
			[
				'an invalid part',
				(release) => rooted(release, (root) => root.parts.push({ sha256: 'a'.repeat(64) })),
				'names an invalid part'
			]
		];
		for (const [, change, message] of cases) {
			const { root, release, blobs } = fixture();
			try {
				change(release, blobs);
				const result = repair(root);
				expect(result.exitCode).not.toBe(0);
				expect(result.stderr).toContain(message);
				expect(result.stored).toEqual([]);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		}
	});
});
