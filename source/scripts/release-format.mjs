import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { canonicalJson } from './canonical-json.mjs';
import {
	PUBLIC_CATALOG_LIMIT,
	PUBLIC_CATALOG_PART_LIMIT,
	PUBLIC_CATALOG_ROOT_LIMIT
} from './public-catalog.mjs';

export { canonicalJsonValue, canonicalJson } from './canonical-json.mjs';

/** Gateways and Web reject larger artifacts, so the build and every release step do too. */
export const CATALOG_ARTIFACT_LIMITS = Object.freeze({
	'catalog.public.json': PUBLIC_CATALOG_ROOT_LIMIT,
	'catalog.runtime.json': 16 * 1024 * 1024
});
/** Where the build writes the parts of the public catalog, each named by its SHA-256. */
export const CATALOG_PARTS_DIRECTORY = 'catalog.public.parts';

/** Rejects an artifact over its limit and warns once it passes three quarters of it. */
export function checkCatalogArtifactSize(name, bytes) {
	const limit = CATALOG_ARTIFACT_LIMITS[name];
	if (!limit) throw new Error(`${name} is not a catalog artifact.`);
	checkSize(name, bytes, limit);
}

/** Rejects a part over its limit, and the public catalog over its limit with every part. */
export function checkCatalogPublicSize(rootBytes, partSizes) {
	for (const size of partSizes) checkSize('A public catalog part', size, PUBLIC_CATALOG_PART_LIMIT);
	checkSize(
		'The public catalog with its parts',
		partSizes.reduce((total, size) => total + size, rootBytes),
		PUBLIC_CATALOG_LIMIT
	);
}

function checkSize(name, bytes, limit) {
	if (bytes > limit) throw new Error(`${name} is ${bytes} bytes; the limit is ${limit}.`);
	if (bytes > limit * 0.75) {
		const message = `${name} is ${bytes} bytes, ${Math.floor((bytes / limit) * 100)}% of its ${limit / 1024 / 1024} MiB limit. Releases fail above the limit.`;
		console.warn(
			process.env.GITHUB_ACTIONS === 'true'
				? `::warning title=Catalog size::${message}`
				: `Warning: ${message}`
		);
	}
}

/** The parts that a public catalog root lists, each by SHA-256 and size. */
export function catalogPublicParts(rootBytes) {
	const root = JSON.parse(Buffer.from(rootBytes).toString('utf8'));
	const seen = new Set();
	if (
		!Array.isArray(root?.parts) ||
		!root.parts.every(
			(part) =>
				hasKeys(part, ['sha256', 'size']) &&
				/^[0-9a-f]{64}$/.test(part.sha256) &&
				!seen.has(part.sha256) &&
				seen.add(part.sha256) &&
				Number.isSafeInteger(part.size) &&
				part.size > 0 &&
				part.size <= PUBLIC_CATALOG_PART_LIMIT
		)
	)
		throw new Error('The public catalog lists an invalid part.');
	checkCatalogPublicSize(
		Buffer.byteLength(rootBytes),
		root.parts.map(({ size }) => size)
	);
	return root.parts;
}

/** The build's parts of the public catalog, each checked against the root that lists it. */
export function catalogPartArtifacts(repositoryRoot) {
	return catalogPublicParts(catalogArtifact(repositoryRoot, 'catalog.public.json').bytes).map(
		({ sha256: digest, size }) => {
			const path = join(repositoryRoot, 'generated', CATALOG_PARTS_DIRECTORY, `${digest}.json`);
			const stats = lstatSync(path);
			if (stats.isSymbolicLink() || !stats.isFile() || stats.size !== size)
				throw new Error(`Public catalog part ${digest} is not a regular file of its size.`);
			const bytes = readFileSync(path);
			if (sha256(bytes) !== digest) throw new Error(`Public catalog part ${digest} differs.`);
			return { bytes, sha256: digest };
		}
	);
}

export function catalogManifest(repositoryRoot, sequenceInput) {
	const sequence = parseSequence(sequenceInput);
	// Missing build output stops a release before any source inspection.
	const artifacts = Object.fromEntries(
		['catalog.public.json', 'catalog.runtime.json'].map((name) => {
			const { bytes } = catalogArtifact(repositoryRoot, name);
			return [name, { sha256: sha256(bytes), size_bytes: bytes.byteLength }];
		})
	);
	const releasePolicy = catalogReleasePolicy(repositoryRoot);
	const commit = git(repositoryRoot, ['rev-parse', 'HEAD']);
	const source = {
		commit,
		repository: 'https://github.com/StogasAI/catalog',
		sha256: sourceDigest(repositoryRoot, commit),
		tag: `catalog-v${sequence}`
	};
	return {
		minimum_gateway_sequence: gatewayReleaseSequence(releasePolicy.minimum_gateway_release),
		artifacts,
		schema: 'stogas.catalog.release.v1',
		sequence,
		source
	};
}

/** Closed Stogas metadata; the external build proof keeps its own signed format. */
export function parseCatalogReleaseEvidence(value) {
	if (!hasKeys(value, ['document', 'provenance']) || !isObject(value.provenance)) {
		throw new Error('Catalog release evidence must contain one document and provenance object.');
	}
	parseCatalogReleaseManifest(value.document);
	return value;
}

export function parseCatalogReleaseManifest(value) {
	const hex = (input, length) =>
		typeof input === 'string' && input.length === length && /^[0-9a-f]+$/.test(input);
	const sequence = (input) => Number.isSafeInteger(input) && input > 0;
	if (
		!hasKeys(value, ['artifacts', 'minimum_gateway_sequence', 'schema', 'sequence', 'source']) ||
		value.schema !== 'stogas.catalog.release.v1' ||
		!sequence(value.sequence) ||
		!sequence(value.minimum_gateway_sequence) ||
		!hasKeys(value.source, ['commit', 'repository', 'sha256', 'tag']) ||
		value.source.repository !== 'https://github.com/StogasAI/catalog' ||
		value.source.tag !== `catalog-v${value.sequence}` ||
		!hex(value.source.commit, 40) ||
		!hex(value.source.sha256, 64) ||
		!hasKeys(value.artifacts, ['catalog.public.json', 'catalog.runtime.json']) ||
		!Object.entries(value.artifacts).every(
			([name, artifact]) =>
				hasKeys(artifact, ['sha256', 'size_bytes']) &&
				hex(artifact.sha256, 64) &&
				sequence(artifact.size_bytes) &&
				artifact.size_bytes <= CATALOG_ARTIFACT_LIMITS[name]
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

export function catalogReleasePolicy(repositoryRoot) {
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
		Object.keys(value).join(',') !== 'minimum_gateway_release' ||
		typeof value.minimum_gateway_release !== 'string'
	) {
		throw new Error('Catalog release policy must contain only minimum_gateway_release.');
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
	if (stats.isSymbolicLink() || !stats.isFile()) {
		throw new Error(`${filename} is not a regular catalog artifact.`);
	}
	if (!(stats.size <= CATALOG_ARTIFACT_LIMITS[filename])) {
		throw new Error(
			`${filename} is ${stats.size} bytes; the limit is ${CATALOG_ARTIFACT_LIMITS[filename]}.`
		);
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

export function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

/**
 * Stogas releases identify source by the SHA-256 of the canonical JSON list of
 * each committed file's path, executable mode and SHA-256, sorted by path. It
 * reads the local object database, so the result never depends on SHA-1 alone.
 */
export function sourceDigest(repositoryRoot, revision) {
	const files = gitBytes(repositoryRoot, ['ls-tree', '-r', '-z', '--full-tree', revision])
		.toString('utf8')
		.split('\0')
		.filter(Boolean)
		.map((row) => {
			const [, mode, object, path] = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/s.exec(row) ?? [];
			if (!path) throw new Error(`Catalog source may contain only regular files: ${row}`);
			return { mode: mode === '100755' ? 0o755 : 0o644, object, path };
		});
	const contents = gitBytes(
		repositoryRoot,
		['cat-file', '--batch'],
		files.map(({ object }) => `${object}\n`).join('')
	);
	let offset = 0;
	const entries = files.map(({ mode, object, path }) => {
		const header = contents.indexOf(10, offset);
		const [id, type, size] = contents.subarray(offset, header).toString('utf8').split(' ');
		const start = header + 1;
		const end = start + Number(size);
		if (id !== object || type !== 'blob' || contents[end] !== 10) {
			throw new Error('Git returned an unexpected catalog source object.');
		}
		offset = end + 1;
		return { mode, path, sha256: sha256(contents.subarray(start, end)) };
	});
	entries.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
	return sha256(JSON.stringify(entries));
}

function git(repositoryRoot, args) {
	return gitBytes(repositoryRoot, args).toString('utf8').trim();
}

function gitBytes(repositoryRoot, args, input) {
	return execFileSync('git', args, {
		cwd: repositoryRoot,
		env: minimalProcessEnvironment(),
		input,
		// The tracked generated artifacts take at most 48 MiB, and the source is far smaller.
		maxBuffer: 96 * 1024 * 1024,
		stdio: ['pipe', 'pipe', 'inherit']
	});
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
