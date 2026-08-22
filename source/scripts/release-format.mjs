import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export { canonicalJson, stableJson } from './canonical-json.mjs';

const MAX_CATALOG_ARTIFACT_BYTES = 64 * 1024 * 1024;

export function catalogManifest(repositoryRoot, sequenceInput) {
	const sequence = parseSequence(sequenceInput);
	const source = {
		commit: git(repositoryRoot, ['rev-parse', 'HEAD']),
		repository: 'https://github.com/StogasAI/catalog',
		tag: `catalog-v${sequence}`,
		tree: git(repositoryRoot, ['rev-parse', 'HEAD^{tree}'])
	};
	return {
		catalogSchema: 1,
		public: catalogArtifact(repositoryRoot, 'catalog.public.json').digest,
		runtime: catalogArtifact(repositoryRoot, 'catalog.runtime.json').digest,
		schema: 'stogas.catalog.release.v1',
		sequence,
		source
	};
}

export function catalogArtifact(repositoryRoot, filename) {
	const path = join(repositoryRoot, 'generated', filename);
	const stats = lstatSync(path);
	if (stats.isSymbolicLink() || !stats.isFile() || stats.size > MAX_CATALOG_ARTIFACT_BYTES) {
		throw new Error(`${filename} is not a bounded regular catalog artifact.`);
	}
	const bytes = readFileSync(path);
	return { bytes, digest: `sha256:${sha256(bytes)}` };
}

export function resolveDestructiveOutput(repositoryRoot, value, options) {
	const candidate = resolve(repositoryRoot, value ?? options.defaultRelative);
	const repositoryDestination = options.allowedRepositoryRoots.some((root) =>
		isWithin(resolve(repositoryRoot, root), candidate)
	);
	const temporaryRoot = resolve(tmpdir());
	const temporaryRelative = relative(temporaryRoot, candidate);
	const temporarySegments = safeRelativeSegments(temporaryRelative);
	const temporaryDestination =
		temporarySegments !== null && temporarySegments[0]?.startsWith('stogas-catalog-');
	if (!repositoryDestination && !temporaryDestination) {
		throw new Error('Catalog output must be in an approved repository or temporary directory.');
	}
	assertNoSymbolicLinks(repositoryDestination ? resolve(repositoryRoot) : temporaryRoot, candidate);
	return candidate;
}

export function stagingDevelopmentProvenance(manifest) {
	const runtime = manifest?.runtime?.match(/^sha256:([0-9a-f]{64})$/)?.[1];
	const publicCatalog = manifest?.public?.match(/^sha256:([0-9a-f]{64})$/)?.[1];
	if (!runtime || !publicCatalog) {
		throw new Error('Catalog development provenance requires valid runtime and public digests.');
	}
	return {
		_type: 'https://in-toto.io/Statement/v1',
		predicate: { environment: 'staging' },
		predicateType: 'https://stogas.ai/attestations/staging-development/v1',
		subject: [
			{ digest: { sha256: runtime }, name: 'catalog.runtime.json' },
			{ digest: { sha256: publicCatalog }, name: 'catalog.public.json' }
		]
	};
}

export function parseSequence(value) {
	if (!/^[1-9][0-9]*$/.test(value ?? '')) {
		throw new Error('Release sequence must be a positive decimal integer.');
	}
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed)) {
		throw new Error('Release sequence exceeds the safe integer range.');
	}
	return parsed;
}

export function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

function git(repositoryRoot, args) {
	return execFileSync('git', args, {
		cwd: repositoryRoot,
		encoding: 'utf8',
		env: minimalProcessEnvironment(),
		maxBuffer: 64 * 1024,
		stdio: ['ignore', 'pipe', 'inherit']
	}).trim();
}

function isWithin(root, candidate) {
	const path = relative(root, candidate);
	return path === '' || safeRelativeSegments(path) !== null;
}

function safeRelativeSegments(path) {
	if (!path || isAbsolute(path)) return path === '' ? [] : null;
	const segments = path.split(sep);
	return segments.some((segment) => !segment || segment === '.' || segment === '..')
		? null
		: segments;
}

function assertNoSymbolicLinks(base, candidate) {
	const segments = safeRelativeSegments(relative(base, candidate));
	if (segments === null) throw new Error('Catalog output escaped its approved directory.');
	let cursor = base;
	for (const segment of segments) {
		cursor = join(cursor, segment);
		if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) {
			throw new Error('Catalog output path must not contain symbolic links.');
		}
	}
}

function minimalProcessEnvironment() {
	const environment = {};
	for (const name of [
		'HOME',
		'LANG',
		'LC_ALL',
		'PATH',
		'PATHEXT',
		'SYSTEMROOT',
		'TEMP',
		'TMP',
		'TMPDIR',
		'USERPROFILE',
		'WINDIR',
		'XDG_CONFIG_HOME'
	]) {
		if (process.env[name] !== undefined) environment[name] = process.env[name];
	}
	return environment;
}
