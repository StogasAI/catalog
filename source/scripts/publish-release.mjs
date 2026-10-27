import { createHmac } from 'node:crypto';
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { getS3Object, putS3Object } from './aws-s3.mjs';
import { readBoundedResponseBuffer, readBoundedResponseText } from './http.mjs';
import {
	catalogArchiveReference,
	catalogArtifact,
	catalogManifest,
	parseCatalogReleaseEvidence,
	canonicalJsonValue,
	parseSequence,
	resolveDestructiveOutput,
	sha256,
	canonicalJson,
	stagingDevelopmentProvenance
} from './release-format.mjs';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const action = process.argv[2];
const sequence = parseSequence(process.argv[3]);
const tag = `catalog-v${sequence}`;
const outputRoot = releaseOutputRoot(process.argv[4]);
const approvalPath = join(outputRoot, 'catalog-approval.json');
const targetBucket = process.argv[5]?.trim();
const publicationEnvironment = process.env.CATALOG_PUBLICATION_ENVIRONMENT?.trim();
if (publicationEnvironment !== 'staging' && publicationEnvironment !== 'prod') {
	throw new Error('CATALOG_PUBLICATION_ENVIRONMENT must be staging or prod.');
}
const immutableCacheControl = 'public, max-age=31536000, immutable';
const requestTimeoutMs = 30_000;
const maxObjectBytes = 128 * 1024 * 1024;
const maxErrorBytes = 64 * 1024;
const retryableObjectStoreStatus = new Set([409, 429, 500, 502, 503, 504]);
// Uploads and readbacks at once.
const objectConcurrency = 8;
let r2CredentialsPromise;
// A catalog becomes current only when Control lists its approval in signed evidence, so
// publication uploads just its two content-addressed artifacts and the archive that the public
// catalog names to both evidence origins.
const destinations = [
	{ get: getR2Object, name: 'R2', put: putR2Object },
	{ get: getS3Object, name: 'S3', put: putS3Object }
];

if (action === 'prepare') {
	await prepareRelease();
} else if (action === 'prepare-placeholder') {
	await preparePlaceholderRelease();
} else if (action === 'repair') {
	await repairRelease();
} else {
	throw new Error(
		'Use: publish-release.mjs <prepare|prepare-placeholder|repair> <sequence> <release-output-dir> [r2-bucket]'
	);
}

async function preparePlaceholderRelease() {
	requireCommands(['git']);
	requireStorageEnvironment();
	if (publicationEnvironment !== 'staging') {
		throw new Error('Placeholder proof is allowed only for staging.');
	}

	const proofRoot = mkdtempSync(join(tmpdir(), 'stogas-catalog-proof-'));
	try {
		const proofPath = join(proofRoot, 'attestation.json');
		writeFileSync(
			proofPath,
			canonicalJson(stagingDevelopmentProvenance(catalogManifest(repositoryRoot, sequence)))
		);
		run(
			process.execPath,
			['source/scripts/create-release.mjs', String(sequence), outputRoot, proofPath],
			commandEnvironment(process.execPath)
		);
	} finally {
		rmSync(proofRoot, { recursive: true, force: true });
	}
	verifyChecksums(outputRoot);
	parseEnvelope(approvalPath);
	await publishImmutables(artifactPaths(outputRoot), outputRoot);
	console.log(`Prepared staging catalog ${sequence} with placeholder GitHub proof.`);
	console.log(`  approval ${approvalPath}`);
}

async function prepareRelease() {
	requireCommands(['gh', 'git']);
	requireStorageEnvironment();
	requireCleanTaggedSource();

	const workRoot = mkdtempSync(join(tmpdir(), `stogas-catalog-${sequence}-`));
	try {
		const proposalRoot = join(workRoot, 'github-proposal');
		downloadAndVerifyGitHubProposal(proposalRoot);
		verifyIndependentBuild(proposalRoot);

		run(
			process.execPath,
			[
				'source/scripts/create-release.mjs',
				String(sequence),
				outputRoot,
				join(proposalRoot, 'github-attestation.jsonl')
			],
			commandEnvironment(process.execPath)
		);
		verifyChecksums(outputRoot);
		const envelope = parseEnvelope(approvalPath);
		const proposedManifest = parseJsonFile(join(proposalRoot, 'catalog-release.json'));
		if (canonicalJsonValue(envelope.document) !== canonicalJsonValue(proposedManifest)) {
			throw new Error('The Stogas manifest differs from the GitHub Actions manifest.');
		}
		await publishImmutables(artifactPaths(outputRoot), outputRoot);
		if (publicationEnvironment === 'prod') {
			publishGitHubRelease(envelope);
		}
		console.log(`Prepared catalog ${sequence}.`);
		console.log(`  approval ${approvalPath}`);
	} finally {
		rmSync(workRoot, { force: true, recursive: true });
	}
}

function readPreparedRelease() {
	requireStorageEnvironment();
	verifyChecksums(outputRoot);
	const approval = parseEnvelope(approvalPath);
	if (
		!approval.provenance ||
		typeof approval.provenance !== 'object' ||
		Array.isArray(approval.provenance)
	) {
		throw new Error('Catalog approval requires one GitHub proof.');
	}
	const proof = approval.provenance;
	if (proof?.predicateType === 'https://stogas.ai/attestations/staging-development/v1') {
		if (
			publicationEnvironment !== 'staging' ||
			canonicalJsonValue(proof) !==
				canonicalJsonValue(stagingDevelopmentProvenance(approval.document))
		) {
			throw new Error('Catalog placeholder proof is invalid for this target.');
		}
	}
}

async function repairRelease() {
	readPreparedRelease();
	const paths = artifactPaths(outputRoot);
	await publishImmutables(paths, outputRoot);
	await requireImmutableReadbacks(paths, outputRoot);
	console.log(`Repaired catalog ${sequence} artifacts.`);
}

function requireCommands(commands) {
	for (const command of commands) {
		run(command, ['--version'], commandEnvironment(command), { stdout: 'ignore' });
	}
}

function requireStorageEnvironment() {
	for (const name of [
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

function releaseOutputRoot(value) {
	const releasesRoot = join(repositoryRoot, 'release');
	const candidate = resolveDestructiveOutput(repositoryRoot, value ?? `release/${tag}`, {
		allowedRepositoryRoots: ['release'],
		defaultRelative: `release/${tag}`
	});
	const pathFromRoot = relative(releasesRoot, candidate);
	if (
		!pathFromRoot ||
		pathFromRoot.startsWith('..') ||
		resolve(releasesRoot, pathFromRoot) !== candidate
	) {
		throw new Error('Catalog release output must be a child of the catalog release directory.');
	}
	return candidate;
}

function requireCleanTaggedSource() {
	if (output('git', ['status', '--porcelain']) !== '') {
		throw new Error('Catalog source must be committed and clean before publication.');
	}
	const head = output('git', ['rev-parse', 'HEAD']);
	const localTag = output('git', ['rev-list', '-n', '1', tag]);
	if (localTag !== head) throw new Error(`${tag} does not identify the checked-out commit.`);
	const remoteRows = output('git', [
		'ls-remote',
		'origin',
		`refs/tags/${tag}`,
		`refs/tags/${tag}^{}`
	])
		.split(/\r?\n/)
		.filter(Boolean);
	const peeled = remoteRows.find((row) => row.endsWith(`refs/tags/${tag}^{}`));
	const direct = remoteRows.find((row) => row.endsWith(`refs/tags/${tag}`));
	const remoteCommit = (peeled ?? direct)?.split(/\s+/)[0];
	if (remoteCommit !== head)
		throw new Error(`${tag} must be published at origin before publication.`);
}

function downloadAndVerifyGitHubProposal(proposalRoot) {
	const release = JSON.parse(
		output('gh', [
			'release',
			'view',
			tag,
			'--repo',
			'StogasAI/catalog',
			'--json',
			'isDraft,tagName'
		])
	);
	if (release.tagName !== tag || typeof release.isDraft !== 'boolean') {
		throw new Error(`GitHub release ${tag} is invalid.`);
	}
	mkdirSync(proposalRoot, { recursive: true });
	run('gh', ['release', 'download', tag, '--repo', 'StogasAI/catalog', '--dir', proposalRoot]);
	for (const name of [
		'catalog.runtime.json',
		'catalog.public.json',
		'catalog-release.json',
		'github-attestation.jsonl',
		'SHA256SUMS'
	]) {
		if (!existsSync(join(proposalRoot, name))) {
			throw new Error(`GitHub release ${tag} is missing ${name}.`);
		}
	}
	verifyChecksums(proposalRoot);
	for (const artifact of ['catalog-release.json', 'catalog.runtime.json', 'catalog.public.json']) {
		run('gh', [
			'attestation',
			'verify',
			join(proposalRoot, artifact),
			'--repo',
			'StogasAI/catalog',
			'--bundle',
			join(proposalRoot, 'github-attestation.jsonl'),
			'--signer-workflow',
			'StogasAI/catalog/.github/workflows/catalog-release.yml',
			'--source-ref',
			`refs/tags/${tag}`,
			'--source-digest',
			output('git', ['rev-parse', 'HEAD']),
			'--deny-self-hosted-runners'
		]);
	}
}

function verifyIndependentBuild(proposalRoot) {
	const expectedManifest = catalogManifest(repositoryRoot, sequence);
	const proposedManifest = parseJsonFile(join(proposalRoot, 'catalog-release.json'));
	if (canonicalJsonValue(proposedManifest) !== canonicalJsonValue(expectedManifest)) {
		throw new Error('GitHub Actions and Stogas produced different catalog manifests.');
	}
	for (const filename of ['catalog.runtime.json', 'catalog.public.json']) {
		const local = catalogArtifact(repositoryRoot, filename).bytes;
		const github = readBoundedRegularFile(join(proposalRoot, filename));
		if (!local.equals(github)) {
			throw new Error(`GitHub Actions and Stogas produced different ${filename} bytes.`);
		}
	}
}

function parseEnvelope(path) {
	const envelope = parseCatalogReleaseEvidence(parseJsonFile(path));
	if (
		envelope.document?.schema !== 'stogas.catalog.release.v1' ||
		envelope.document.sequence !== sequence
	) {
		throw new Error('Generated catalog release is invalid.');
	}
	return envelope;
}

function verifyChecksums(root) {
	const absoluteRoot = resolve(root);
	const seen = new Set();
	for (const line of readBoundedRegularFile(join(root, 'SHA256SUMS'))
		.toString('utf8')
		.trim()
		.split('\n')) {
		const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
		if (!match) throw new Error('Release checksum file is malformed.');
		const relativePath = match[2];
		if (
			relativePath.includes('\\') ||
			seen.has(relativePath) ||
			relativePath.startsWith('/') ||
			relativePath.split('/').some((segment) => !segment || segment === '.' || segment === '..')
		) {
			throw new Error('Release checksum file contains an invalid path.');
		}
		seen.add(relativePath);
		const path = resolve(absoluteRoot, relativePath);
		const pathFromRoot = relative(absoluteRoot, path);
		if (!pathFromRoot || pathFromRoot.startsWith('..')) {
			throw new Error('Release checksum file contains an unsafe path.');
		}
		const bytes = readContainedRegularFile(absoluteRoot, relativePath);
		if (sha256(bytes) !== match[1]) {
			throw new Error(`Release checksum failed for ${relativePath}.`);
		}
	}
}

function artifactPaths(root) {
	const directory = join(root, 'blobs', 'sha256');
	assertContainedDirectory(root, 'blobs/sha256');
	const entries = readdirSync(directory, { withFileTypes: true });
	const envelope = parseEnvelope(join(root, 'catalog-approval.json'));
	const blob = ({ sha256: digest, size }) => {
		const bytes = readContainedRegularFile(root, `blobs/sha256/${digest}.json`);
		if (bytes.byteLength !== size || sha256(bytes) !== digest)
			throw new Error('Catalog blob differs from its approved digest');
		return bytes;
	};
	const artifacts = Object.values(envelope.document.artifacts).map((artifact) => ({
		sha256: artifact.sha256,
		size: artifact.size_bytes
	}));
	const publicCatalog = blob({
		sha256: envelope.document.artifacts['catalog.public.json'].sha256,
		size: envelope.document.artifacts['catalog.public.json'].size_bytes
	});
	const blobs = [...artifacts, catalogArchiveReference(publicCatalog)].filter(Boolean);
	const expected = new Set(blobs.map((artifact) => `${artifact.sha256}.json`));
	if (
		entries.length !== expected.size ||
		entries.some((entry) => !entry.isFile() || !expected.has(entry.name))
	) {
		throw new Error(
			'Catalog release must contain exactly the blobs that its manifest and public catalog name.'
		);
	}
	for (const artifact of blobs) blob(artifact);
	return entries.map((entry) => join(directory, entry.name)).sort();
}

async function publishImmutables(paths, root) {
	await eachLimited(paths, (path) => publishImmutable(path, root));
}

async function eachLimited(items, task) {
	const queue = [...items];
	await Promise.all(
		Array.from({ length: Math.min(objectConcurrency, queue.length) }, async () => {
			while (queue.length) await task(queue.shift());
		})
	);
}

async function publishImmutable(path, root) {
	const key = objectKey(relative(root, path).replaceAll('\\', '/'));
	const bytes = readBoundedRegularFile(path);
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
				ifNoneMatch: '*'
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

async function requireImmutableReadbacks(paths, root) {
	await eachLimited(
		destinations.flatMap((destination) => paths.map((path) => ({ destination, path }))),
		async ({ destination, path }) => {
			const key = objectKey(relative(root, path).replaceAll('\\', '/'));
			const published = await destination.get(key);
			if (!published || !readBoundedRegularFile(path).equals(published.bytes)) {
				throw new Error(`Catalog object ${key} is absent or different in ${destination.name}.`);
			}
		}
	);
}

function publishGitHubRelease(envelope) {
	run('gh', [
		'release',
		'edit',
		tag,
		'--repo',
		'StogasAI/catalog',
		'--draft=false',
		'--title',
		`Catalog ${sequence}`,
		'--notes',
		[
			`Runtime: ${envelope.document.artifacts['catalog.runtime.json'].sha256}`,
			`Public: ${envelope.document.artifacts['catalog.public.json'].sha256}`,
			'',
			'Stogas rebuilt these artifacts from its own copy of the source and got the same SHA-256 values before approving them.'
		].join('\n')
	]);
}

async function getR2Object(key) {
	const response = await r2Request('GET', key);
	if (response.status === 404) {
		await response.body?.cancel();
		return null;
	}
	if (!response.ok) {
		await response.body?.cancel().catch(() => {});
		throw new Error(`R2 GET ${key} failed (${response.status}).`);
	}
	return { bytes: await readBoundedResponseBuffer(response, maxObjectBytes) };
}

async function putR2Object(key, bytes, options = {}) {
	const headers = {
		'cache-control': options.cacheControl,
		'content-type': 'application/json'
	};
	if (options.ifNoneMatch) headers['if-none-match'] = options.ifNoneMatch;
	const response = await r2Request('PUT', key, bytes, headers);
	if (!response.ok) {
		await response.body?.cancel().catch(() => {});
		throw new Error(`R2 PUT ${key} failed (${response.status}).`);
	}
	await response.body?.cancel().catch(() => {});
}

function bucket() {
	const value = targetBucket || requiredEnvironment('R2_BUCKET');
	if (value.length > 255 || hasAsciiControl(value)) {
		throw new Error('R2 bucket is invalid.');
	}
	return value;
}

async function r2Request(method, key, body, extraHeaders = {}) {
	let lastError;
	for (let attempt = 1; attempt <= 3; attempt += 1) {
		try {
			const signed = await signedR2Request(method, key, body, extraHeaders);
			const response = await fetch(signed.url, {
				body,
				headers: signed.headers,
				method,
				redirect: 'error',
				signal: AbortSignal.timeout(requestTimeoutMs)
			});
			if (response.redirected) {
				await response.body?.cancel();
				throw new Error(`R2 ${method} ${key} redirected unexpectedly`);
			}
			if (!retryableObjectStoreStatus.has(response.status) || attempt === 3) return response;
			await response.body?.cancel();
			lastError = new Error(`R2 returned retryable HTTP ${response.status}`);
		} catch (error) {
			lastError = error;
			if (attempt === 3) throw error;
		}
		await new Promise((resolve) => setTimeout(resolve, attempt * 100));
	}
	throw lastError;
}

async function signedR2Request(method, key, body, extraHeaders) {
	const credentials = await r2Credentials();
	const account = requiredEnvironment('CLOUDFLARE_ACCOUNT_ID');
	if (!/^[0-9a-f]{32}$/.test(account)) throw new Error('CLOUDFLARE_ACCOUNT_ID is invalid.');
	const host = `${account}.r2.cloudflarestorage.com`;
	const canonicalUri = `/${encodeRfc3986(bucket())}/${key.split('/').map(encodeRfc3986).join('/')}`;
	const now = new Date();
	const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
	const date = amzDate.slice(0, 8);
	const payloadHash = sha256(body ?? '');
	const headers = {
		host,
		'x-amz-content-sha256': payloadHash,
		'x-amz-date': amzDate,
		...definedHeaders(extraHeaders)
	};
	const headerNames = Object.keys(headers).sort();
	const canonicalHeaders = headerNames
		.map((name) => `${name}:${String(headers[name]).trim().replace(/\s+/g, ' ')}\n`)
		.join('');
	const signedHeaders = headerNames.join(';');
	const canonicalRequest = [
		method,
		canonicalUri,
		'',
		canonicalHeaders,
		signedHeaders,
		payloadHash
	].join('\n');
	const scope = `${date}/auto/s3/aws4_request`;
	const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
	const dateKey = hmac(`AWS4${credentials.secretAccessKey}`, date);
	const regionKey = hmac(dateKey, 'auto');
	const serviceKey = hmac(regionKey, 's3');
	const signingKey = hmac(serviceKey, 'aws4_request');
	const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
	headers.authorization =
		`AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, ` +
		`SignedHeaders=${signedHeaders}, Signature=${signature}`;
	return { headers, url: `https://${host}${canonicalUri}` };
}

function r2Credentials() {
	if (!r2CredentialsPromise) r2CredentialsPromise = resolveR2Credentials();
	return r2CredentialsPromise;
}

async function resolveR2Credentials() {
	const account = requiredEnvironment('CLOUDFLARE_ACCOUNT_ID');
	const apiToken = requiredEnvironment('CLOUDFLARE_API_TOKEN');
	const response = await fetch(
		`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/tokens/verify`,
		{
			headers: { authorization: `Bearer ${apiToken}` },
			redirect: 'error',
			signal: AbortSignal.timeout(requestTimeoutMs)
		}
	);
	if (response.redirected) {
		await response.body?.cancel().catch(() => {});
		throw new Error('R2 token verification redirected unexpectedly.');
	}
	const body = await readBoundedResponseText(response, maxErrorBytes).catch(() => '');
	if (!response.ok) {
		throw new Error(`R2 token verification failed (${response.status}).`);
	}
	let verified;
	try {
		verified = JSON.parse(body);
	} catch {
		throw new Error('R2 token verification returned invalid JSON.');
	}
	const accessKeyId = verified?.result?.id;
	if (verified?.success !== true || verified?.result?.status !== 'active' || !accessKeyId) {
		throw new Error('R2 API token is not active.');
	}
	return {
		accessKeyId,
		secretAccessKey: sha256(apiToken)
	};
}

function definedHeaders(headers) {
	return Object.fromEntries(
		Object.entries(headers).filter(([, value]) => value !== undefined && value !== null)
	);
}

function encodeRfc3986(value) {
	return encodeURIComponent(value).replace(
		/[!'()*]/g,
		(character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
	);
}

function hmac(key, value) {
	return createHmac('sha256', key).update(value).digest();
}

function objectKey(path) {
	const prefix = (process.env.R2_PREFIX ?? 'catalog').trim().replace(/^\/+|\/+$/g, '');
	const normalizedPath = validObjectPath(path, 'Catalog object path');
	return prefix ? `${validObjectPath(prefix, 'R2 prefix')}/${normalizedPath}` : normalizedPath;
}

function validObjectPath(value, label) {
	if (
		value.length === 0 ||
		value.length > 1024 ||
		value.includes('\\') ||
		hasAsciiControl(value) ||
		value.split('/').some((segment) => !segment || segment === '.' || segment === '..')
	) {
		throw new Error(`${label} is invalid.`);
	}
	return value;
}

function hasAsciiControl(value) {
	for (const character of value) {
		const code = character.charCodeAt(0);
		if (code <= 0x1f || code === 0x7f) return true;
	}
	return false;
}

function requiredEnvironment(name) {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`${name} is required.`);
	return value;
}

function parseJsonFile(path) {
	return JSON.parse(readBoundedRegularFile(path).toString('utf8'));
}

function readBoundedRegularFile(path) {
	const stats = lstatSync(path);
	if (stats.isSymbolicLink() || !stats.isFile() || stats.size > maxObjectBytes) {
		throw new Error(`${basename(path)} must be a bounded regular file.`);
	}
	return readFileSync(path);
}

function readContainedRegularFile(root, relativePath) {
	const segments = relativePath.split('/');
	let cursor = root;
	for (const [index, segment] of segments.entries()) {
		cursor = join(cursor, segment);
		const stats = lstatSync(cursor);
		if (stats.isSymbolicLink()) throw new Error('Release path must not contain symbolic links.');
		if (index < segments.length - 1 && !stats.isDirectory()) {
			throw new Error('Release path contains a non-directory parent.');
		}
		if (index === segments.length - 1 && (!stats.isFile() || stats.size > maxObjectBytes)) {
			throw new Error('Release file is not a bounded regular file.');
		}
	}
	return readFileSync(cursor);
}

function assertContainedDirectory(root, relativePath) {
	let cursor = resolve(root);
	for (const segment of relativePath.split('/')) {
		cursor = join(cursor, segment);
		const stats = lstatSync(cursor);
		if (stats.isSymbolicLink() || !stats.isDirectory()) {
			throw new Error('Release path must contain only regular directories.');
		}
	}
}

function output(command, args) {
	return run(command, args, undefined, { capture: true }).trim();
}

function run(command, args, env, options = {}) {
	const result = spawn(command, args, { ...options, env: env ?? commandEnvironment(command) });
	return result.stdout;
}

function spawn(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: repositoryRoot,
		encoding: 'utf8',
		env: options.env ?? process.env,
		maxBuffer: 8 * 1024 * 1024,
		stdio: options.capture
			? ['ignore', 'pipe', 'inherit']
			: ['ignore', options.stdout ?? 'inherit', 'inherit']
	});
	if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
	if (result.signal) throw new Error(`${command} was terminated by ${result.signal}.`);
	if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}.`);
	return { status: result.status ?? 1, stdout: result.stdout ?? '' };
}

function commandEnvironment(command) {
	const environment = { ...process.env };
	for (const name of [
		'AWS_ACCESS_KEY_ID',
		'AWS_BUCKET',
		'AWS_OBJECT_LOCK_ENABLED',
		'AWS_REGION',
		'AWS_SECRET_ACCESS_KEY',
		'AWS_SESSION_TOKEN',
		'CLOUDFLARE_ACCOUNT_ID',
		'CLOUDFLARE_API_TOKEN',
		'R2_BUCKET',
		'R2_PREFIX'
	]) {
		delete environment[name];
	}
	if (command !== 'gh') {
		delete environment.GH_TOKEN;
		delete environment.GITHUB_TOKEN;
	}
	return environment;
}
