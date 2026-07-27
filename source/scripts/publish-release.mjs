import { createHash, createPublicKey } from 'node:crypto';
import { compareSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const sequence = parseSequence(process.argv[2]);
const requestedChannel = process.argv[3];
if (!['canary', 'stable'].includes(requestedChannel)) {
	throw new Error('Publication requires an explicit canary or stable channel.');
}
const tag = `catalog-v${sequence}`;
const workRoot = mkdtempSync(join(tmpdir(), `stogas-catalog-${sequence}-`));
const draftRoot = join(workRoot, 'draft');
const releaseRoot = join(workRoot, 'release');

try {
	requireCommands();
	requireCleanSource();
	run('gh', ['release', 'download', tag, '--repo', 'StogasAI/catalog', '--dir', draftRoot]);

	const draftPath = join(draftRoot, 'catalog.draft.json');
	for (const path of [
		draftPath,
		join(draftRoot, 'catalog.runtime.json'),
		join(draftRoot, 'catalog.public.json')
	]) {
		run('gh', ['attestation', 'verify', path, '--repo', 'StogasAI/catalog']);
	}

	const draft = parseDraft(draftPath);
	if (draft.sequence !== sequence)
		throw new Error('Draft sequence does not match the requested release.');
	if (draft.channel !== requestedChannel) {
		throw new Error(
			`Draft channel ${draft.channel} does not match requested channel ${requestedChannel}.`
		);
	}
	const sourceCommit = output('git', ['rev-parse', 'HEAD']);
	if (draft.source.commit !== sourceCommit) {
		throw new Error(
			`Draft source commit ${draft.source.commit} does not match local HEAD ${sourceCommit}.`
		);
	}

	run('bun', ['install', '--frozen-lockfile']);
	run('bun', ['run', 'check']);
	assertArtifact(draft, 'runtime', 'catalog.runtime.json');
	assertArtifact(draft, 'public', 'catalog.public.json');
	verifySigningKey();

	run(process.execPath, ['source/scripts/create-release.mjs', String(sequence), releaseRoot], {
		...process.env,
		CATALOG_MIN_GATEWAY_VERSION: draft.minGatewayVersion,
		CATALOG_SOURCE_COMMIT: sourceCommit,
		CATALOG_SOURCE_TIMESTAMP: draft.createdAt
	});
	verifyChecksums(releaseRoot);

	const immutableFiles = [
		...draftArtifactPaths(releaseRoot, 'blobs/sha256'),
		join(releaseRoot, 'releases', `${sequence}.json`)
	];
	for (const path of immutableFiles) publishImmutable(path, releaseRoot);
	publishGitHubAssets(releaseRoot);
	run('gh', [
		'release',
		'edit',
		tag,
		'--repo',
		'StogasAI/catalog',
		'--draft=false',
		'--latest=false'
	]);
	activateChannel(requestedChannel, join(releaseRoot, 'channel.json'));
	console.log(`Published catalog ${sequence} to ${requestedChannel}.`);
} finally {
	rmSync(workRoot, { force: true, recursive: true });
}

function requireCommands() {
	for (const command of ['aws', 'bun', 'gh', 'git']) {
		run(command, ['--version'], process.env, { stdout: 'ignore' });
	}
	for (const name of [
		'AWS_ACCESS_KEY_ID',
		'AWS_SECRET_ACCESS_KEY',
		'CATALOG_SIGNING_KEY_ID',
		'CATALOG_SIGNING_PRIVATE_KEY_PEM',
		'R2_BUCKET',
		'R2_ENDPOINT'
	]) {
		requiredEnvironment(name);
	}
}

function requireCleanSource() {
	if (output('git', ['status', '--porcelain']) !== '') {
		throw new Error('Catalog source must be committed and clean before publication.');
	}
}

function parseDraft(path) {
	const draft = JSON.parse(readFileSync(path, 'utf8'));
	if (
		draft?.schema !== 'stogas.catalog.draft.v1' ||
		!['canary', 'stable'].includes(draft.channel) ||
		draft.source?.repository !== 'https://github.com/StogasAI/catalog' ||
		typeof draft.minGatewayVersion !== 'string' ||
		!draft.minGatewayVersion
	) {
		throw new Error('Catalog draft metadata is invalid.');
	}
	return draft;
}

function assertArtifact(draft, key, filename) {
	const generated = join(repositoryRoot, 'generated', filename);
	const proposed = join(draftRoot, filename);
	const generatedBytes = readFileSync(generated);
	const proposedBytes = readFileSync(proposed);
	if (compareSync(generatedBytes, proposedBytes) !== 0) {
		throw new Error(`${filename} differs from the attested GitHub draft.`);
	}
	const expected = draft[key];
	const digest = `sha256:${sha256(generatedBytes)}`;
	if (expected?.digest !== digest || expected?.size !== generatedBytes.byteLength) {
		throw new Error(`${filename} does not match its draft metadata.`);
	}
}

function verifySigningKey() {
	const id = requiredEnvironment('CATALOG_SIGNING_KEY_ID');
	const privateKey = requiredEnvironment('CATALOG_SIGNING_PRIVATE_KEY_PEM');
	const keyring = JSON.parse(
		readFileSync(join(repositoryRoot, 'keys/catalog-signing-keys.json'), 'utf8')
	);
	const trusted = keyring[id];
	if (typeof trusted !== 'string')
		throw new Error(`Catalog signing key ${id} is not trusted by this source.`);
	const actual = createPublicKey(privateKey)
		.export({ format: 'der', type: 'spki' })
		.subarray(-32)
		.toString('base64');
	if (actual !== trusted)
		throw new Error(`Catalog signing key ${id} does not match its committed public key.`);
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

function draftArtifactPaths(root, relative) {
	const directory = join(root, relative);
	return readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => join(directory, entry.name))
		.sort();
}

function publishImmutable(path, root) {
	const key = path.slice(root.length + 1);
	const existing = join(workRoot, `existing-${basename(path)}`);
	const head = spawn('aws', awsArgs(['s3api', 'head-object', '--bucket', bucket(), '--key', key]), {
		allowFailure: true,
		stdout: 'ignore'
	});
	if (head.status === 0) {
		run(
			'aws',
			awsArgs(['s3api', 'get-object', '--bucket', bucket(), '--key', key, existing]),
			process.env,
			{
				stdout: 'ignore'
			}
		);
		if (compareSync(readFileSync(path), readFileSync(existing)) !== 0) {
			throw new Error(`Refusing to overwrite immutable catalog object ${key}.`);
		}
		return;
	}
	run(
		'aws',
		awsArgs([
			's3api',
			'put-object',
			'--bucket',
			bucket(),
			'--key',
			key,
			'--body',
			path,
			'--content-type',
			'application/json',
			'--cache-control',
			'public,max-age=31536000,immutable',
			'--if-none-match',
			'*'
		]),
		process.env,
		{ stdout: 'ignore' }
	);
}

function publishGitHubAssets(root) {
	const assets = [
		join(root, 'releases', `${sequence}.json`),
		...draftArtifactPaths(root, 'blobs/sha256'),
		join(root, 'SHA256SUMS')
	];
	run('gh', ['release', 'upload', tag, '--repo', 'StogasAI/catalog', ...assets, '--clobber']);
}

function activateChannel(channel, path) {
	const key = `channels/${channel}.json`;
	const existing = join(workRoot, `channel-${channel}.json`);
	const head = spawn(
		'aws',
		awsArgs([
			's3api',
			'head-object',
			'--bucket',
			bucket(),
			'--key',
			key,
			'--query',
			'ETag',
			'--output',
			'text'
		]),
		{ allowFailure: true, capture: true }
	);
	const conditional = [];
	if (head.status === 0) {
		run(
			'aws',
			awsArgs(['s3api', 'get-object', '--bucket', bucket(), '--key', key, existing]),
			process.env,
			{
				stdout: 'ignore'
			}
		);
		const current = JSON.parse(readFileSync(existing, 'utf8'));
		if (
			!Number.isSafeInteger(current?.manifest?.sequence) ||
			current.manifest.sequence >= sequence
		) {
			throw new Error(
				`Catalog channel ${channel} is already at sequence ${current?.manifest?.sequence}.`
			);
		}
		conditional.push('--if-match', head.stdout.trim());
	} else {
		conditional.push('--if-none-match', '*');
	}
	run(
		'aws',
		awsArgs([
			's3api',
			'put-object',
			'--bucket',
			bucket(),
			'--key',
			key,
			'--body',
			path,
			'--content-type',
			'application/json',
			'--cache-control',
			'no-store',
			...conditional
		]),
		process.env,
		{ stdout: 'ignore' }
	);
}

function awsArgs(args) {
	return [...args, '--endpoint-url', requiredEnvironment('R2_ENDPOINT'), '--region', 'auto'];
}

function bucket() {
	return requiredEnvironment('R2_BUCKET');
}

function parseSequence(value) {
	if (!/^[1-9][0-9]*$/.test(value ?? '')) {
		throw new Error('Release sequence must be a positive decimal integer.');
	}
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed))
		throw new Error('Release sequence exceeds the safe integer range.');
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
