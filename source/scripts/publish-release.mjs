import { createHash, createPublicKey } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const sequence = parseSequence(process.argv[2]);
const targetBucket = process.argv[3]?.trim();
const tag = `catalog-v${sequence}`;
const workRoot = mkdtempSync(join(tmpdir(), `stogas-catalog-${sequence}-`));
const releaseRoot = join(workRoot, 'release');

try {
	requireCommands();
	requireCleanPublishedSource();
	const latest = await readLatest();
	if (latest.envelope && latest.envelope.manifest.sequence > sequence) {
		throw new Error(
			`Catalog latest is already sequence ${latest.envelope.manifest.sequence}; ${sequence} would roll it back.`
		);
	}

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
		'CLOUDFLARE_API_TOKEN'
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
	const existing = await getObject(key);
	if (existing) {
		if (!readFileSync(path).equals(existing.bytes)) {
			throw new Error(`Refusing to overwrite immutable catalog object ${key}.`);
		}
		return;
	}
	await putObject(key, readFileSync(path));
	const published = await getObject(key);
	if (!published || !readFileSync(path).equals(published.bytes)) {
		throw new Error(`Catalog object ${key} failed post-publication verification.`);
	}
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
	const current = await getObject(key);
	if (!current) return { envelope: null, path };
	const envelope = JSON.parse(current.bytes.toString('utf8'));
	if (
		envelope?.schema !== 'stogas.catalog.signed.v2' ||
		!Number.isSafeInteger(envelope.manifest?.sequence)
	) {
		throw new Error('Published catalog latest.json is invalid.');
	}
	return { bytes: current.bytes, envelope, path };
}

async function activateLatest(latest, path) {
	if (latest.envelope?.manifest.sequence === sequence) return;
	const bytes = readFileSync(path);
	await putObject(objectKey('latest.json'), bytes);
	const published = await getObject(objectKey('latest.json'));
	if (!published || !bytes.equals(published.bytes)) {
		throw new Error('Catalog latest.json failed post-publication verification.');
	}
}

async function getObject(key) {
	const response = await fetch(objectUrl(key), {
		headers: { authorization: `Bearer ${requiredEnvironment('CLOUDFLARE_API_TOKEN')}` }
	});
	if (response.status === 404) return null;
	if (!response.ok) {
		throw new Error(`R2 GET ${key} failed (${response.status}): ${await response.text()}`);
	}
	return {
		bytes: Buffer.from(await response.arrayBuffer())
	};
}

async function putObject(key, bytes) {
	const response = await fetch(objectUrl(key), {
		body: bytes,
		headers: {
			authorization: `Bearer ${requiredEnvironment('CLOUDFLARE_API_TOKEN')}`,
			'content-type': 'application/json'
		},
		method: 'PUT'
	});
	if (!response.ok) {
		throw new Error(`R2 PUT ${key} failed (${response.status}): ${await response.text()}`);
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
