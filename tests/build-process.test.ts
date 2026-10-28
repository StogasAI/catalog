import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPublicCatalog } from './generated-catalog';

// These cases launch real compilers; use the same bound as each build process.
setDefaultTimeout(60_000);

const catalogRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Builds running in this checkout keep `.tmp-` paths in these folders; copy only catalog inputs.
const copyInputs = {
	recursive: true,
	filter: (path: string) => !basename(path).includes('.tmp-')
};
const temporaryParents = new Set<string>();

afterEach(() => {
	for (const path of temporaryParents) rmSync(path, { force: true, recursive: true });
	temporaryParents.clear();
});

function catalogCopy() {
	const parent = mkdtempSync(join(tmpdir(), 'stogas-catalog-build-'));
	temporaryParents.add(parent);
	const root = join(parent, 'catalog');
	mkdirSync(root);
	cpSync(join(catalogRoot, 'source'), join(root, 'source'), copyInputs);
	cpSync(join(catalogRoot, 'generated'), join(root, 'generated'), copyInputs);
	return root;
}

function runBuild(root: string, args: string[] = [], environment: Record<string, string> = {}) {
	const env = Object.fromEntries(
		Object.entries(process.env).filter((entry): entry is [string, string] => Boolean(entry[1]))
	);
	delete env.CUE_BIN;
	const result = Bun.spawnSync({
		cmd: ['node', 'source/scripts/build.mjs', ...args],
		cwd: root,
		env: { ...env, ...environment },
		stderr: 'pipe',
		stdout: 'pipe',
		timeout: 60_000
	});
	return {
		exitCode: result.exitCode,
		output: `${result.stdout.toString()}${result.stderr.toString()}`
	};
}

function expectBuildSuccess(result: ReturnType<typeof runBuild>) {
	if (result.exitCode !== 0) throw new Error(result.output);
}

function writeExecutable(path: string, source: string) {
	writeFileSync(path, source);
	chmodSync(path, 0o755);
}

function defaultCuePath() {
	const cacheRoot =
		process.env.STOGAS_CATALOG_TOOL_CACHE_DIR?.trim() ||
		(process.env.XDG_CACHE_HOME?.trim()
			? join(process.env.XDG_CACHE_HOME, 'stogas/catalog-tools')
			: join(homedir(), '.cache/stogas/catalog-tools'));
	return join(cacheRoot, 'cue/v0.16.1/cue');
}

function pinnedCuePath() {
	for (const path of [defaultCuePath(), Bun.which('cue')]) {
		if (!path || !existsSync(path)) continue;
		const result = Bun.spawnSync({ cmd: [path, 'version'], stderr: 'pipe', stdout: 'pipe' });
		if (result.exitCode === 0 && /^cue version v0\.16\.1$/m.test(result.stdout.toString())) {
			return path;
		}
	}
	throw new Error('a pinned CUE binary was not resolved by the successful catalog build');
}

function installedNodePath() {
	const path = Bun.which('node');
	if (!path) throw new Error('node is required for catalog build process tests');
	return path;
}

function replaceSource(root: string, path: string, from: string, to: string) {
	const absolutePath = join(root, path);
	const source = readFileSync(absolutePath, 'utf8');
	if (!source.includes(from)) throw new Error(`${path} does not contain the expected fixture text`);
	writeFileSync(absolutePath, source.replace(from, to));
}

describe('catalog build process boundaries', () => {
	test('rejects an invalid node filename before generating YAML', () => {
		const root = catalogCopy();
		for (const id of ['Uppercase', 'has space', 'line\nbreak', '__proto__', 'trailing\n']) {
			const path = join(root, `source/data/${id}.yaml`);
			writeFileSync(path, 'models:\n  unknown: true\n');
			const result = runBuild(root, ['--validate-only']);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain(`invalid node ID ${JSON.stringify(id)}`);
			expect(existsSync(join(root, 'source/.tmp-catalog-build'))).toBe(false);
			rmSync(path);
		}
	});

	for (const kind of ['authors', 'groups', 'models', 'providers', 'routes', 'deployments']) {
		test(`rejects invalid ${kind} labels through CUE without filename-derived IDs`, () => {
			const root = catalogCopy();
			writeFileSync(
				join(root, 'source/data/invalid-collection.yaml'),
				JSON.stringify({
					[kind]: Object.fromEntries(
						['Uppercase', 'has space', 'line\nbreak', '__proto__'].map((id) => [
							id,
							{ unknown: true }
						])
					)
				})
			);
			const result = runBuild(root, ['--validate-only']);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain('field not allowed');
			expect(result.output).toContain(kind);
		});
	}

	test('quotes valid file-owned IDs that YAML could otherwise interpret as scalars or syntax', () => {
		const root = catalogCopy();
		for (const id of ['null', 'true', '123', 'a:']) {
			writeFileSync(join(root, `source/data/${id}.yaml`), 'authors:\n  name: Quoted identifier\n');
		}
		expectBuildSuccess(runBuild(root, ['--validate-only']));
	});

	test('validates and checks without changing artifacts, then cleans only its copied outputs', () => {
		const root = catalogCopy();
		const runtime = readFileSync(join(root, 'generated/catalog.runtime.json'), 'utf8');
		const publicCatalog = readFileSync(join(root, 'generated/catalog.public.json'), 'utf8');

		expectBuildSuccess(runBuild(root, ['--validate-only']));
		expect(readFileSync(join(root, 'generated/catalog.runtime.json'), 'utf8')).toBe(runtime);
		expect(readFileSync(join(root, 'generated/catalog.public.json'), 'utf8')).toBe(publicCatalog);
		expect(existsSync(join(root, 'source/.tmp-catalog-build'))).toBe(false);

		expectBuildSuccess(runBuild(root, ['--check']));
		rmSync(join(root, 'generated'), { recursive: true });
		expectBuildSuccess(runBuild(root));
		expect(readFileSync(join(root, 'generated/catalog.runtime.json'), 'utf8')).toBe(runtime);
		expect(readFileSync(join(root, 'generated/catalog.public.json'), 'utf8')).toBe(publicCatalog);
		expect(readPublicCatalog(join(root, 'generated')).catalog).toEqual(
			readPublicCatalog(join(catalogRoot, 'generated')).catalog
		);
		mkdirSync(join(root, 'source/.tmp-catalog-build'));
		expectBuildSuccess(runBuild(root, ['--clean']));
		expect(existsSync(join(root, 'generated'))).toBe(false);
		expect(existsSync(join(root, 'source/.tmp-catalog-build'))).toBe(false);
	});

	test('rejects a stale artifact and removes temporary compiler input', () => {
		const root = catalogCopy();
		writeFileSync(join(root, 'generated/catalog.runtime.json'), '{}\n');
		const result = runBuild(root, ['--check']);
		expect(result.exitCode).not.toBe(0);
		expect(result.output).toContain('Generated catalog artifacts are stale');
		expect(existsSync(join(root, 'source/.tmp-catalog-build'))).toBe(false);
	});

	for (const kind of ['file', 'symlink'] as const) {
		test(`rejects a generated ${kind} before compilation`, () => {
			const root = catalogCopy();
			rmSync(join(root, 'generated'), { recursive: true });
			if (kind === 'file') {
				writeFileSync(join(root, 'generated'), 'not a directory');
			} else {
				symlinkSync(join(root, 'source'), join(root, 'generated'), 'dir');
			}
			const result = runBuild(root, ['--validate-only']);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain('generated must be a regular directory');
		});
	}

	test('rejects a configured CUE binary with the wrong version and cleans temporary input', () => {
		const root = catalogCopy();
		const result = runBuild(root, ['--validate-only'], { CUE_BIN: '/bin/true' });
		expect(result.exitCode).not.toBe(0);
		expect(result.output).toContain('CUE_BIN must select CUE v0.16.1');
		expect(existsSync(join(root, 'source/.tmp-catalog-build'))).toBe(false);
	});

	test('accepts a configured CUE binary only at the pinned version', () => {
		const root = catalogCopy();
		expectBuildSuccess(runBuild(root, ['--validate-only']));
		const cue = pinnedCuePath();
		expect(cue).toBeTruthy();
		expectBuildSuccess(runBuild(root, ['--validate-only'], { CUE_BIN: cue }));
	});

	test('ignores a stale cached CUE binary when a pinned system binary exists', () => {
		const root = catalogCopy();
		expectBuildSuccess(runBuild(root, ['--validate-only']));
		const pinnedCue = pinnedCuePath();
		expect(pinnedCue).toBeTruthy();

		const tools = join(dirname(root), 'stale-cache-tools');
		const cache = join(tools, 'cache');
		const cacheBin = join(cache, 'cue/v0.16.1');
		const pathBin = join(tools, 'path');
		mkdirSync(cacheBin, { recursive: true });
		mkdirSync(pathBin);
		writeExecutable(join(cacheBin, 'cue'), "#!/bin/sh\nprintf 'cue version v0.15.0\\n'\n");
		symlinkSync(pinnedCue, join(pathBin, 'cue'));
		symlinkSync(installedNodePath(), join(pathBin, 'node'));

		expectBuildSuccess(
			runBuild(root, ['--validate-only'], {
				PATH: pathBin,
				STOGAS_CATALOG_TOOL_CACHE_DIR: cache
			})
		);
	});

	test('rejects a Go installation that does not produce the pinned CUE version', () => {
		const root = catalogCopy();
		const tools = join(dirname(root), 'wrong-installed-cue-tools');
		const cache = join(tools, 'cache');
		const pathBin = join(tools, 'path');
		mkdirSync(pathBin, { recursive: true });
		symlinkSync(installedNodePath(), join(pathBin, 'node'));
		writeExecutable(
			join(pathBin, 'go'),
			`#!/bin/sh
if [ "$1" = "version" ]; then
	printf 'go version go1.26.0 linux/amd64\\n'
	exit 0
fi
if [ "$1" = "install" ]; then
	printf '#!/bin/sh\\nprintf "cue version v0.15.0\\\\n"\\n' > "$GOBIN/cue"
	/bin/chmod 755 "$GOBIN/cue"
	exit 0
fi
exit 1
`
		);

		const result = runBuild(root, ['--validate-only'], {
			PATH: pathBin,
			STOGAS_CATALOG_TOOL_CACHE_DIR: cache
		});
		expect(result.exitCode).not.toBe(0);
		expect(result.output).toContain('Installed CUE does not match v0.16.1');
		expect(existsSync(join(root, 'source/.tmp-catalog-build'))).toBe(false);
	});

	test('uses a successful pinned CUE installation from Go', () => {
		const root = catalogCopy();
		expectBuildSuccess(runBuild(root, ['--validate-only']));
		const pinnedCue = pinnedCuePath();
		expect(pinnedCue).toBeTruthy();

		const tools = join(dirname(root), 'go-installed-cue-tools');
		const cache = join(tools, 'cache');
		const pathBin = join(tools, 'path');
		mkdirSync(pathBin, { recursive: true });
		symlinkSync(installedNodePath(), join(pathBin, 'node'));
		writeExecutable(
			join(pathBin, 'go'),
			`#!/bin/sh
if [ "$1" = "version" ]; then
	printf 'go version go1.26.0 linux/amd64\\n'
	exit 0
fi
if [ "$1" = "install" ]; then
	/bin/ln -s "$REAL_CUE" "$GOBIN/cue"
	exit 0
fi
exit 1
`
		);

		const result = runBuild(root, ['--validate-only'], {
			PATH: pathBin,
			REAL_CUE: pinnedCue,
			STOGAS_CATALOG_TOOL_CACHE_DIR: cache
		});
		expectBuildSuccess(result);
		expect(existsSync(join(cache, 'cue/v0.16.1/cue'))).toBe(true);
		expect(existsSync(join(root, 'source/.tmp-catalog-build'))).toBe(false);
	});

	test('fails cleanly when neither CUE nor Go is available', () => {
		const root = catalogCopy();
		const tools = join(dirname(root), 'missing-cue-tools');
		const cache = join(tools, 'cache');
		const pathBin = join(tools, 'path');
		mkdirSync(pathBin, { recursive: true });
		symlinkSync(installedNodePath(), join(pathBin, 'node'));

		const result = runBuild(root, ['--validate-only'], {
			PATH: pathBin,
			STOGAS_CATALOG_TOOL_CACHE_DIR: cache
		});
		expect(result.exitCode).not.toBe(0);
		expect(result.output).toContain('CUE is required');
		expect(existsSync(join(root, 'source/.tmp-catalog-build'))).toBe(false);
	});

	for (const fixture of [
		...['Unknown', 'openai'].map((format) => ({
			name: `noncanonical Azure model format ${JSON.stringify(format)}`,
			path: 'source/data/providers/azure/deployments/azure-gpt-5.6-sol.yaml',
			from: '    modelFormat: OpenAI',
			to: `    modelFormat: ${JSON.stringify(format)}`,
			error: 'modelFormat'
		})),
		{
			name: 'unknown document format property',
			path: 'source/data/providers/openai/routes/openai-chat-completions.yaml',
			from: '  documentFormats:',
			to: '  documentFormats:\n    unknown: true',
			error: 'unknown'
		},
		{
			name: 'provider-owned document formats',
			path: 'source/data/providers/openai/openai.yaml',
			from: '  name: OpenAI',
			to: '  name: OpenAI\n  documentFormats: {extensions: [], mediaTypes: []}',
			error: 'documentFormats'
		},
		{
			name: 'document formats below route overrides',
			path: 'source/data/providers/openai/routes/openai-chat-completions.yaml',
			from: '  providerId: openai',
			to: '  providerId: openai\n  overrides:\n    documentFormats: {extensions: [], mediaTypes: []}',
			error: 'documentFormats'
		},
		{
			name: 'Azure upstream fields on an OpenAI deployment',
			path: 'source/data/providers/openai/deployments/openai-gpt-5.6-sol.yaml',
			from: '    model: gpt-5.6-sol\n',
			to: '    model: gpt-5.6-sol\n    modelFormat: OpenAI\n',
			error: 'modelFormat'
		},
		{
			name: "a route of another provider than the deployment's directory",
			path: 'source/data/providers/openai/deployments/openai-gpt-5.6-sol.yaml',
			from: 'routeIds: [openai-chat-completions, openai-responses]',
			to: 'routeIds: [openai-chat-completions, anthropic-messages]',
			error: 'route anthropic-messages belongs to anthropic, not openai'
		},
		{
			name: 'document formats below deployment overrides',
			path: 'source/data/providers/openai/deployments/openai-gpt-5.6-sol.yaml',
			from: '  pricing:\n',
			to: '  overrides:\n    documentFormats: {extensions: [], mediaTypes: []}\n  pricing:\n',
			error: 'documentFormats'
		},
		{
			name: 'deployment override that adds a capability',
			path: 'source/data/providers/openai/deployments/openai-gpt-5.6-sol.yaml',
			from: '  pricing:\n',
			to: '  overrides:\n    capabilities: {streaming: true}\n  pricing:\n',
			error: 'streaming'
		},
		{
			name: 'empty group name',
			path: 'source/data/authors/openai/groups/gpt-oss.yaml',
			from: "  name: 'gpt-oss'",
			to: "  name: ''",
			error: 'name'
		},
		{
			name: 'group execution facts',
			path: 'source/data/authors/openai/groups/gpt-oss.yaml',
			from: '  authorId: openai',
			to: '  authorId: openai\n  dataHandling: {zeroDataRetention: true}',
			error: 'dataHandling'
		},
		{
			name: 'legacy provider moderation field',
			path: 'source/data/providers/anthropic/anthropic.yaml',
			from: '  dataHandling:',
			to: '  moderated: true\n  dataHandling:',
			error: 'moderated'
		},
		{
			name: 'legacy route moderation field',
			path: 'source/data/providers/openai/routes/openai-responses.yaml',
			from: '  dataHandling:',
			to: '  moderated: true\n  dataHandling:',
			error: 'moderated'
		},
		{
			name: 'token rate without a short prompt price',
			path: 'source/data/providers/openai/deployments/openai-gpt-5.6-sol.yaml',
			from: "    input_tokens:\n      per_mill_tokens: '4'\n",
			to: '    input_tokens:\n',
			error: 'per_mill_tokens'
		},
		{
			name: 'token rate with an unknown prompt size key',
			path: 'source/data/providers/openai/deployments/openai-gpt-5.6-sol.yaml',
			from: "      per_mill_context_gt_272k: '8'",
			to: "      per_mill_context_lte_272k: '8'",
			error: 'per_mill_context_lte_272k'
		},
		{
			name: 'legacy deployment moderation field',
			path: 'source/data/providers/openai/deployments/openai-gpt-5.6-sol.yaml',
			from: '  pricing:\n',
			to: '  moderated: true\n  pricing:\n',
			error: 'moderated'
		}
	] as const) {
		test(`rejects ${fixture.name} through the closed CUE schema`, () => {
			const root = catalogCopy();
			replaceSource(root, fixture.path, fixture.from, fixture.to);
			const result = runBuild(root, ['--validate-only']);
			expect(result.exitCode).not.toBe(0);
			expect(result.output).toContain(fixture.error);
			expect(existsSync(join(root, 'source/.tmp-catalog-build'))).toBe(false);
		});
	}

	const datedPrice = (price: string, name = 'November input discount') =>
		[
			'  periods:',
			`    - name: '${name}'`,
			'      start: 2026-11-01T00:00:00Z',
			'      end: 2026-12-01T00:00:00Z',
			'      set:',
			`        pricing.input_tokens.per_mill_tokens: '${price}'`,
			'  pricing:\n'
		].join('\n');

	test('writes, checks and removes the archive as its date moves', () => {
		const root = catalogCopy();
		const policyPath = join(root, 'source/release-policy.json');
		const policy = readFileSync(policyPath, 'utf8');
		const archivePath = join(root, 'generated/catalog.archive.json');
		const active = readPublicCatalog(join(root, 'generated')).catalog;
		const retiring = Object.entries(active.graph.deployments)
			.filter(([, { retirementDate }]) => retirementDate === '2027-09-01')
			.map(([id]) => id);
		expect(retiring.length).toBeGreaterThan(0);

		writeFileSync(
			policyPath,
			policy.replace(/"archive_through": "[^"]+"/, '"archive_through": "2027-09-01"')
		);
		expect(runBuild(root, ['--check']).output).toContain('Generated catalog artifacts are stale');
		expectBuildSuccess(runBuild(root));
		const { catalog, archive } = readPublicCatalog(join(root, 'generated'));
		const bytes = readFileSync(archivePath);
		expect(catalog.archive).toEqual({
			sha256: createHash('sha256').update(bytes).digest('hex'),
			size: bytes.byteLength
		});
		expect(Object.keys(archive!.graph.deployments).sort()).toEqual(retiring.sort());
		for (const id of retiring) expect(catalog.graph.deployments[id]).toBeUndefined();
		expectBuildSuccess(runBuild(root, ['--check']));
		writeFileSync(archivePath, bytes.toString('utf8').replace('"modelId"', '"modelId" '));
		expect(runBuild(root, ['--check']).output).toContain('Generated catalog artifacts are stale');

		writeFileSync(policyPath, policy);
		expectBuildSuccess(runBuild(root));
		expect(existsSync(archivePath)).toBe(false);
		expect(readPublicCatalog(join(root, 'generated')).catalog).toEqual(active);
		expectBuildSuccess(runBuild(root, ['--check']));
	});

	test('compiles a dated period from source into both schedules', () => {
		const root = catalogCopy();
		const path = 'source/data/providers/openai/deployments/openai-gpt-5.6-sol.yaml';
		replaceSource(root, path, '  pricing:\n', datedPrice('2'));
		expectBuildSuccess(runBuild(root));
		const generated = join(root, 'generated');
		const publicCatalog = readPublicCatalog(generated);
		const starts = ['2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z'];
		for (const catalog of [
			JSON.parse(readFileSync(join(generated, 'catalog.runtime.json'), 'utf8')),
			publicCatalog.catalog
		]) {
			expect(catalog.schedule.map(({ start }: { start: string }) => start)).toEqual(starts);
			expect(
				catalog.schedule[0].graph.deployments['openai-gpt-5.6-sol'].routes['openai-responses']
					.pricing.input_tokens.per_mill_tokens
			).toBe('2');
		}
		expect(publicCatalog.catalog.periods).toEqual([
			{
				kind: 'deployments',
				id: 'openai-gpt-5.6-sol',
				name: 'November input discount',
				start: '2026-11-01T00:00:00Z',
				end: '2026-12-01T00:00:00Z'
			}
		]);
	});

	test('rejects a dated period without a name', () => {
		const root = catalogCopy();
		const path = 'source/data/providers/openai/deployments/openai-gpt-5.6-sol.yaml';
		replaceSource(root, path, '  pricing:\n', datedPrice('2', ''));
		const result = runBuild(root, ['--validate-only']);
		expect(result.exitCode).not.toBe(0);
		expect(result.output).toContain('name');
	});

	test('rejects a dated state that the closed CUE schema rejects', () => {
		const root = catalogCopy();
		const path = 'source/data/providers/openai/deployments/openai-gpt-5.6-sol.yaml';
		replaceSource(root, path, '  pricing:\n', datedPrice('free'));
		const result = runBuild(root, ['--validate-only']);
		expect(result.exitCode).not.toBe(0);
		expect(result.output).toContain('The catalog state from 2026-11-01T00:00:00Z is invalid');
		expect(result.output).toContain('per_mill_tokens');
	});
});
