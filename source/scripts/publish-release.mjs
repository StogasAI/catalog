import { createHash, createPublicKey } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { getS3Object, putS3Object } from './aws-s3.mjs';
import { readBoundedResponseBuffer, readBoundedResponseText } from './http.mjs';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const sequence = parseSequence(process.argv[2]);
const targetBucket = process.argv[3]?.trim();
const tag = `catalog-v${sequence}`;
const workRoot = mkdtempSync(join(tmpdir(), `stogas-catalog-${sequence}-`));
const releaseRoot = join(workRoot, 'release');
const latestCacheControl = 'public, max-age=0, s-maxage=30, stale-if-error=300, no-transform';
const immutableCacheControl = 'public, max-age=31536000, immutable, no-transform';
const requestTimeoutMs = 30_000;
const maxObjectBytes = 128 * 1024 * 1024;
const maxErrorBytes = 64 * 1024;
const destinations = [
	{
		get: getR2Object,
		name: 'R2',
		put: putR2Object
	},
	{
		get: getS3Object,
		name: 'S3',
		put: putS3Object
	}
];

try {
	requireCommands();
	const latest = await readLatest();
	if (latest.envelope && latest.envelope.manifest.sequence > sequence) {
		throw new Error(
			`Catalog latest is already sequence ${latest.envelope.manifest.sequence}; ${sequence} would roll it back.`
		);
	}
	const repairsExistingRelease = latest.envelope?.manifest.sequence === sequence;
	if (!repairsExistingRelease) requireCleanPublishedSource();

	run('bun', ['install', '--frozen-lockfile']);
	run('bun', ['run', 'check']);
	verifySigningKey();
	run(process.execPath, ['source/scripts/create-release.mjs', String(sequence), releaseRoot]);
	verifyChecksums(releaseRoot);

	const releasePath = join(releaseRoot, 'releases', `${sequence}.json`);
	const envelope = parseEnvelope(releasePath);
	if (latest.envelope?.manifest.sequence === sequence) {
		if (!readFileSync(releasePath).equals(latest.bytes)) {
			throw new Error(`Catalog sequence ${sequence} is already bound to different content.`);
		}
		console.log(`Repairing catalog ${sequence} from its existing signed release.`);
	}

	for (const path of [...artifactPaths(releaseRoot), releasePath]) {
		await publishImmutable(path, releaseRoot);
	}
	publishGitHubRelease(envelope);
	await activateLatest(latest, join(releaseRoot, 'latest.json'));
	console.log(`Published catalog ${sequence}.`);
} finally {
	rmSync(workRoot, { force: true, recursive: true });
}

function requireCommands() {
	for (const command of ['bun', 'gh', 'git']) {
		run(command, ['--version'], process.env, { stdout: 'ignore' });
	}
	for (const name of [
		'CATALOG_SIGNING_KEY_ID',
		'CATALOG_SIGNING_PRIVATE_KEY_PEM',
		'CLOUDFLARE_ACCOUNT_ID',
		'CLOUDFLARE_API_TOKEN',
		'AWS_ACCESS_KEY_ID',
		'AWS_BUCKET',
		'AWS_REGION',
		'AWS_SECRET_ACCESS_KEY'
	]) {
		requiredEnvironment(name);
	}
	if (!targetBucket) requiredEnvironment('R2_BUCKET');
}

function requireCleanPublishedSource() {
	if (output('git', ['status', '--porcelain']) !== '') {
		throw new Error('Catalog source must be committed and clean before publication.');
	}
	const head = output('git', ['rev-parse', 'HEAD']);
	const remote = output('git', ['ls-remote', 'origin', 'refs/heads/main']).split(/\s+/)[0];
	if (!remote || remote !== head) {
		throw new Error('Catalog HEAD must be published at origin/main before release.');
	}
}

function verifySigningKey() {
	const id = requiredEnvironment('CATALOG_SIGNING_KEY_ID');
	const privateKey = requiredEnvironment('CATALOG_SIGNING_PRIVATE_KEY_PEM');
	const keyring = JSON.parse(
		readFileSync(join(repositoryRoot, 'keys/catalog-signing-keys.json'), 'utf8')
	);
	const trusted = keyring[id];
	if (typeof trusted !== 'string') {
		throw new Error(`Catalog signing key ${id} is not trusted by this source.`);
	}
	const actual = createPublicKey(privateKey)
		.export({ format: 'der', type: 'spki' })
		.toString('base64');
	if (actual !== trusted) {
		throw new Error(`Catalog signing key ${id} does not match its committed public key.`);
	}
}

function parseEnvelope(path) {
	const envelope = JSON.parse(readFileSync(path, 'utf8'));
	if (
		envelope?.schema !== 'stogas.catalog.signed.v2' ||
		envelope.manifest?.schema !== 'stogas.catalog.release.v2' ||
		envelope.manifest.sequence !== sequence
	) {
		throw new Error('Generated catalog release is invalid.');
	}
	return envelope;
}

function verifyChecksums(root) {
	for (const line of readFileSync(join(root, 'SHA256SUMS'), 'utf8').trim().split('\n')) {
		const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
		if (!match) throw new Error('Release checksum file is malformed.');
		const path = join(root, match[2]);
		if (sha256(readFileSync(path)) !== match[1]) {
			throw new Error(`Release checksum failed for ${match[2]}.`);
		}
	}
}

function artifactPaths(root) {
	const directory = join(root, 'blobs', 'sha256');
	return readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => join(directory, entry.name))
		.sort();
}

async function publishImmutable(path, root) {
	const key = objectKey(path.slice(root.length + 1));
	const bytes = readFileSync(path);
	await Promise.all(
		destinations.map(async (destination) => {
			const existing = await destination.get(key);
			if (existing) {
				if (!bytes.equals(existing.bytes)) {
					throw new Error(
						`Refusing to overwrite immutable catalog object ${key} in ${destination.name}.`
					);
				}
				return;
			}
			await destination.put(key, bytes, {
				cacheControl: immutableCacheControl,
				ifNoneMatch: '*',
				immutable: true
			});
			const published = await destination.get(key);
			if (!published || !bytes.equals(published.bytes)) {
				throw new Error(
					`Catalog object ${key} failed ${destination.name} post-publication verification.`
				);
			}
		})
	);
}

function publishGitHubRelease(envelope) {
	const assets = [
		join(releaseRoot, 'releases', `${sequence}.json`),
		...artifactPaths(releaseRoot),
		join(releaseRoot, 'SHA256SUMS')
	];
	const existing = spawn('gh', ['release', 'view', tag, '--repo', 'StogasAI/catalog'], {
		allowFailure: true,
		stdout: 'ignore'
	});
	if (existing.status === 0) {
		const downloaded = join(workRoot, 'github-release');
		run('gh', ['release', 'download', tag, '--repo', 'StogasAI/catalog', '--dir', downloaded]);
		for (const path of assets) {
			const remote = join(downloaded, basename(path));
			if (!readFileSync(path).equals(readFileSync(remote))) {
				throw new Error(`GitHub release ${tag} contains different ${basename(path)} bytes.`);
			}
		}
		return;
	}
	const head = output('git', ['rev-parse', 'HEAD']);
	run('gh', [
		'release',
		'create',
		tag,
		'--repo',
		'StogasAI/catalog',
		'--target',
		head,
		'--title',
		`Catalog ${sequence}`,
		'--notes',
		[`Runtime: ${envelope.manifest.runtime}`, `Public: ${envelope.manifest.public}`].join('\n'),
		...assets
	]);
}

async function readLatest() {
	const path = join(workRoot, 'latest.json');
	const key = objectKey('latest.json');
	const states = await Promise.all(
		destinations.map(async (destination) => {
			const current = await destination.get(key);
			if (!current) return { current: null, destination, envelope: null };
			return {
				current,
				destination,
				envelope: parsePublishedEnvelope(current.bytes, destination.name)
			};
		})
	);
	const published = states.filter((state) => state.envelope);
	for (let left = 0; left < published.length; left++) {
		for (let right = left + 1; right < published.length; right++) {
			if (
				published[left].envelope.manifest.sequence ===
					published[right].envelope.manifest.sequence &&
				!published[left].current.bytes.equals(published[right].current.bytes)
			) {
				throw new Error(
					`Catalog sequence ${published[left].envelope.manifest.sequence} is bound to different bytes in ${published[left].destination.name} and ${published[right].destination.name}.`
				);
			}
		}
	}
	published.sort(
		(left, right) => right.envelope.manifest.sequence - left.envelope.manifest.sequence
	);
	return {
		bytes: published[0]?.current.bytes,
		envelope: published[0]?.envelope ?? null,
		path,
		states
	};
}

async function activateLatest(latest, path) {
	const bytes = readFileSync(path);
	const key = objectKey('latest.json');
	await Promise.all(
		latest.states.map(async ({ current, destination, envelope }) => {
			if (envelope?.manifest.sequence === sequence) {
				if (!bytes.equals(current.bytes)) {
					throw new Error(
						`Catalog sequence ${sequence} is already bound to different content in ${destination.name}.`
					);
				}
				return;
			}
			await destination.put(key, bytes, {
				cacheControl: latestCacheControl,
				ifMatch: current?.etag ?? undefined,
				ifNoneMatch: current ? undefined : '*'
			});
			const published = await destination.get(key);
			if (!published || !bytes.equals(published.bytes)) {
				throw new Error(
					`Catalog latest.json failed ${destination.name} post-publication verification.`
				);
			}
		})
	);
}

function parsePublishedEnvelope(bytes, destination) {
	const envelope = JSON.parse(bytes.toString('utf8'));
	if (
		envelope?.schema !== 'stogas.catalog.signed.v2' ||
		!Number.isSafeInteger(envelope.manifest?.sequence)
	) {
		throw new Error(`Published catalog latest.json in ${destination} is invalid.`);
	}
	return envelope;
}

async function getR2Object(key) {
	const response = await fetch(objectUrl(key), {
		headers: { authorization: `Bearer ${requiredEnvironment('CLOUDFLARE_API_TOKEN')}` },
		signal: AbortSignal.timeout(requestTimeoutMs)
	});
	if (response.status === 404) return null;
	if (!response.ok) {
		const body = await readBoundedResponseText(response, maxErrorBytes).catch(() => '');
		throw new Error(`R2 GET ${key} failed (${response.status}): ${body}`);
	}
	return {
		bytes: await readBoundedResponseBuffer(response, maxObjectBytes),
		etag: response.headers.get('etag')
	};
}

async function putR2Object(key, bytes, options = {}) {
	const response = await fetch(objectUrl(key), {
		body: bytes,
		headers: {
			authorization: `Bearer ${requiredEnvironment('CLOUDFLARE_API_TOKEN')}`,
			'cache-control': options.cacheControl,
			'content-type': 'application/json'
		},
		method: 'PUT',
		signal: AbortSignal.timeout(requestTimeoutMs)
	});
	if (!response.ok) {
		const body = await readBoundedResponseText(response, maxErrorBytes).catch(() => '');
		throw new Error(`R2 PUT ${key} failed (${response.status}): ${body}`);
	}
}

function bucket() {
	return targetBucket || requiredEnvironment('R2_BUCKET');
}

function objectUrl(key) {
	const account = encodeURIComponent(requiredEnvironment('CLOUDFLARE_ACCOUNT_ID'));
	const bucketName = encodeURIComponent(bucket());
	const safeKey = key
		.split('/')
		.map((segment) => encodeURIComponent(segment))
		.join('/');
	return `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${bucketName}/objects/${safeKey}`;
}

function objectKey(path) {
	const prefix = (process.env.R2_PREFIX ?? 'catalog').trim().replace(/^\/+|\/+$/g, '');
	return prefix ? `${prefix}/${path}` : path;
}

function parseSequence(value) {
	if (!/^[1-9][0-9]*$/.test(value ?? '')) {
		throw new Error('Release sequence must be a positive decimal integer.');
	}
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed)) {
		throw new Error('Release sequence exceeds the safe integer range.');
	}
	return parsed;
}

function requiredEnvironment(name) {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`${name} is required.`);
	return value;
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

function output(command, args) {
	return run(command, args, process.env, { capture: true }).trim();
}

function run(command, args, env = process.env, options = {}) {
	const result = spawn(command, args, { ...options, env });
	if (result.status !== 0) {
		throw new Error(`${command} failed with exit code ${result.status}.`);
	}
	return result.stdout;
}

function spawn(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: repositoryRoot,
		encoding: 'utf8',
		env: options.env ?? process.env,
		stdio: options.capture
			? ['ignore', 'pipe', 'inherit']
			: ['ignore', options.stdout ?? 'inherit', 'inherit']
	});
	if (!options.allowFailure && result.status !== 0) {
		throw new Error(`${command} failed with exit code ${result.status}.`);
	}
	return {
		status: result.status ?? 1,
		stdout: result.stdout ?? ''
	};
}
