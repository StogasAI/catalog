import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { canonicalJson } from './canonical-json.mjs';
import { parseArchiveReference } from './catalog-archive.mjs';

export { canonicalJsonValue, canonicalJson } from './canonical-json.mjs';

const MAX_CATALOG_ARTIFACT_BYTES = 64 * 1024 * 1024;

export function catalogManifest(repositoryRoot, sequenceInput) {
	catalogArchive(repositoryRoot);
	const sequence = parseSequence(sequenceInput);
	const releasePolicy = catalogReleasePolicy(repositoryRoot);
	const source = {
		commit: git(repositoryRoot, ['rev-parse', 'HEAD']),
		repository: 'https://github.com/StogasAI/catalog',
		tag: `catalog-v${sequence}`,
		tree: git(repositoryRoot, ['rev-parse', 'HEAD^{tree}'])
	};
	return {
		minimum_gateway_sequence: gatewayReleaseSequence(releasePolicy.minimum_gateway_release),
		artifacts: Object.fromEntries(
			['catalog.public.json', 'catalog.runtime.json'].map((name) => {
				const { bytes } = catalogArtifact(repositoryRoot, name);
				return [name, { sha256: sha256(bytes), size_bytes: bytes.byteLength }];
			})
		),
		schema: 'stogas.catalog.release.v1',
		sequence,
		source
	};
}

/** Closed Stogas metadata; the external build proof keeps its own signed format. */
export function parseCatalogReleaseEvidence(value) {
	if (!hasKeys(value, ['document', 'provenance', 'signature']) || !isObject(value.provenance)) {
		throw new Error(
			'Catalog release evidence must contain one document, signature and provenance object.'
		);
	}
	parseCatalogReleaseManifest(value.document);
	if (
		!hasKeys(value.signature, ['key_id', 'signature']) ||
		!/^[A-Za-z0-9._-]{1,128}$/.test(value.signature.key_id ?? '') ||
		!/^[A-Za-z0-9_-]{4412}$/.test(value.signature.signature ?? '')
	) {
		throw new Error('Catalog release signature format is invalid.');
	}
	return value;
}

export function parseCatalogReleaseManifest(value) {
	const digest = (input) => typeof input === 'string' && /^[0-9a-f]{64}$/.test(input);
	const sequence = (input) => Number.isSafeInteger(input) && input > 0;
	if (
		!hasKeys(value, ['artifacts', 'minimum_gateway_sequence', 'schema', 'sequence', 'source']) ||
		value.schema !== 'stogas.catalog.release.v1' ||
		!sequence(value.sequence) ||
		!sequence(value.minimum_gateway_sequence) ||
		!hasKeys(value.source, ['commit', 'repository', 'tag', 'tree']) ||
		value.source.repository !== 'https://github.com/StogasAI/catalog' ||
		value.source.tag !== `catalog-v${value.sequence}` ||
		![value.source.commit, value.source.tree].every(
			(hash) => typeof hash === 'string' && /^[0-9a-f]{40}$/.test(hash)
		) ||
		!hasKeys(value.artifacts, ['catalog.public.json', 'catalog.runtime.json']) ||
		!Object.values(value.artifacts).every(
			(artifact) =>
				hasKeys(artifact, ['sha256', 'size_bytes']) &&
				digest(artifact.sha256) &&
				sequence(artifact.size_bytes) &&
				artifact.size_bytes <= MAX_CATALOG_ARTIFACT_BYTES
		)
	) {
		throw new Error('Catalog release document is invalid.');
	}
	return value;
}

function isObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasKeys(value, keys) {
	return (
		isObject(value) &&
		Object.keys(value).length === keys.length &&
		keys.every((key) => Object.hasOwn(value, key))
	);
}

function catalogReleasePolicy(repositoryRoot) {
	const path = join(repositoryRoot, 'source', 'release-policy.json');
	let value;
	try {
		value = JSON.parse(readFileSync(path, 'utf8'));
	} catch (error) {
		throw new Error(`Catalog release policy is invalid: ${error.message}`, { cause: error });
	}
	if (
		!value ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		Object.keys(value).length !== 1 ||
		typeof value.minimum_gateway_release !== 'string'
	) {
		throw new Error('Catalog release policy must contain one canonical minimum_gateway_release.');
	}
	gatewayReleaseSequence(value.minimum_gateway_release);
	return value;
}

function gatewayReleaseSequence(releaseTag) {
	const match = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.exec(releaseTag);
	if (!match)
		throw new Error('minimum_gateway_release must use canonical vMAJOR.MINOR.PATCH form.');
	const [major, minor, patch] = match.slice(1).map(BigInt);
	if (minor >= 1_000_000n || patch >= 1_000_000n) {
		throw new Error('minimum_gateway_release exceeds the release sequence range.');
	}
	const sequence = major * 1_000_000_000_000n + minor * 1_000_000n + patch;
	if (sequence === 0n || sequence > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new Error('minimum_gateway_release exceeds the release sequence range.');
	}
	return Number(sequence);
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

export function catalogArchive(repositoryRoot) {
	const publicCatalog = JSON.parse(
		catalogArtifact(repositoryRoot, 'catalog.public.json').bytes.toString('utf8')
	);
	const reference = parseArchiveReference(publicCatalog.archive);
	const artifact = catalogArtifact(repositoryRoot, `blobs/sha256/${reference.sha256}.json`);
	if (
		artifact.bytes.byteLength !== reference.size_bytes ||
		artifact.digest !== `sha256:${reference.sha256}`
	) {
		throw new Error('Catalog archive differs from its public root');
	}
	return artifact;
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
	const runtime = manifest?.artifacts?.['catalog.runtime.json']?.sha256;
	const publicCatalog = manifest?.artifacts?.['catalog.public.json']?.sha256;
	if (!/^[0-9a-f]{64}$/.test(runtime ?? '') || !/^[0-9a-f]{64}$/.test(publicCatalog ?? '')) {
		throw new Error('Catalog development provenance requires valid runtime and public digests.');
	}
	const manifestDigest = sha256(canonicalJson(manifest));
	return {
		_type: 'https://in-toto.io/Statement/v1',
		predicate: { environment: 'staging' },
		predicateType: 'https://stogas.ai/attestations/staging-development/v1',
		subject: [
			{ digest: { sha256: manifestDigest }, name: 'catalog-release.json' },
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

export function catalogApprovalLedgerKey(relativePath) {
	const approval = /^approvals\/([1-9][0-9]*)[.]json$/.exec(relativePath);
	return approval ? `ledger/v1/catalogs/${approval[1]}.json` : null;
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
