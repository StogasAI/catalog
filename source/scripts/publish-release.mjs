import { createHash, createHmac, createPublicKey } from 'node:crypto';
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
import { r2WriteConditionETag } from './r2-etag.mjs';
import {
	catalogArtifact,
	catalogManifest,
	canonicalJson,
	stableJson,
	stagingDevelopmentProvenance
} from './release-format.mjs';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const action = process.argv[2];
const sequence = parseSequence(process.argv[3]);
const tag = `catalog-v${sequence}`;
const outputRoot = releaseOutputRoot(process.argv[4]);
const targetBucket = process.argv[5]?.trim();
const latestBrowserCacheControl = 'public, max-age=0, must-revalidate, stale-if-error=0';
const latestEdgeCacheControl = 'public, max-age=5, stale-while-revalidate=2, stale-if-error=0';
const immutableCacheControl = 'public, max-age=31536000, immutable';
const requestTimeoutMs = 30_000;
const maxObjectBytes = 128 * 1024 * 1024;
const maxErrorBytes = 64 * 1024;
const retryableObjectStoreStatus = new Set([409, 429, 500, 502, 503, 504]);
let r2CredentialsPromise;
const destinations = [
	{
		get: getR2Object,
		latestCacheControl: latestBrowserCacheControl,
		name: 'R2',
		put: putR2Object
	},
	{
		get: getS3Object,
		latestCacheControl: latestEdgeCacheControl,
		name: 'S3',
		put: putS3Object
	}
];

if (action === 'prepare') {
	await prepareRelease();
} else if (action === 'prepare-development') {
	await prepareDevelopmentRelease();
} else if (action === 'activate') {
	await activateRelease();
} else {
	throw new Error(
		'Use: publish-release.mjs <prepare|prepare-development|activate> <sequence> <release-output-dir> [r2-bucket]'
	);
}

async function prepareDevelopmentRelease() {
	requireCommands(['bun', 'git']);
	requireStorageEnvironment();
	for (const name of ['CATALOG_SIGNING_KEY_ID', 'CATALOG_SIGNING_PRIVATE_KEY_PEM']) {
		requiredEnvironment(name);
	}
	if (process.env.CATALOG_PUBLICATION_ENVIRONMENT?.trim() !== 'staging') {
		throw new Error('Development catalog publication is accepted only for staging.');
	}

	run('bun', ['install', '--frozen-lockfile']);
	run('bun', ['run', 'build']);
	run('bun', ['run', 'check'], catalogCheckEnvironment());
	verifySigningKey();
	run(process.execPath, ['source/scripts/create-release.mjs', String(sequence), outputRoot]);
	verifyChecksums(outputRoot);
	const releasePath = join(outputRoot, 'releases', `${sequence}.json`);
	const envelope = parseEnvelope(releasePath);
	const approval = {
		github_in_toto: [stagingDevelopmentProvenance(envelope.manifest)],
		signed_release: envelope
	};
	const approvalPath = writeApproval(approval);

	const latest = await readLatest();
	assertMayPublishSequence(latest, readFileSync(releasePath));
	for (const path of [...artifactPaths(outputRoot), releasePath, approvalPath]) {
		await publishImmutable(path, outputRoot);
	}
	console.log(`Prepared staging development catalog ${sequence}.`);
	console.log(`  approval ${approvalPath}`);
}

async function prepareRelease() {
	requireCommands(['bun', 'gh', 'git']);
	requireStorageEnvironment();
	for (const name of ['CATALOG_SIGNING_KEY_ID', 'CATALOG_SIGNING_PRIVATE_KEY_PEM']) {
		requiredEnvironment(name);
	}
	requireCleanTaggedSource();

	const workRoot = mkdtempSync(join(tmpdir(), `stogas-catalog-${sequence}-`));
	try {
		run('bun', ['install', '--frozen-lockfile']);
		run('bun', ['run', 'check'], catalogCheckEnvironment());
		verifySigningKey();

		const proposalRoot = join(workRoot, 'github-proposal');
		downloadAndVerifyGitHubProposal(proposalRoot);
		verifyIndependentBuild(proposalRoot);

		run(process.execPath, ['source/scripts/create-release.mjs', String(sequence), outputRoot]);
		verifyChecksums(outputRoot);
		const releasePath = join(outputRoot, 'releases', `${sequence}.json`);
		const envelope = parseEnvelope(releasePath);
		const proposedManifest = parseJsonFile(join(proposalRoot, 'catalog-release.json'));
		if (canonicalJson(envelope.manifest) !== canonicalJson(proposedManifest)) {
			throw new Error('The Stogas manifest differs from the GitHub Actions manifest.');
		}

		const approval = {
			github_in_toto: [readSingleAttestation(join(proposalRoot, 'github-attestation.jsonl'))],
			signed_release: envelope
		};
		const approvalPath = writeApproval(approval);

		const latest = await readLatest();
		assertMayPublishSequence(latest, readFileSync(releasePath));
		for (const path of [...artifactPaths(outputRoot), releasePath, approvalPath]) {
			await publishImmutable(path, outputRoot);
		}
		publishGitHubRelease(proposalRoot, releasePath, approvalPath, envelope);
		console.log(`Prepared catalog ${sequence}.`);
		console.log(`  approval ${approvalPath}`);
	} finally {
		rmSync(workRoot, { force: true, recursive: true });
	}
}

function writeApproval(approval) {
	const approvalPath = join(outputRoot, 'approvals', `${sequence}.json`);
	mkdirSync(join(outputRoot, 'approvals'), { recursive: true });
	writeFileSync(approvalPath, stableJson(approval));
	writeFileSync(join(outputRoot, 'catalog-approval.json'), stableJson(approval));
	appendChecksum(outputRoot, approvalPath);
	verifyChecksums(outputRoot);
	return approvalPath;
}

async function activateRelease() {
	requireStorageEnvironment();
	verifyChecksums(outputRoot);
	const releasePath = join(outputRoot, 'releases', `${sequence}.json`);
	const approvalPath = join(outputRoot, 'approvals', `${sequence}.json`);
	const latestPath = join(outputRoot, 'latest.json');
	const envelope = parseEnvelope(releasePath);
	const approval = parseJsonFile(approvalPath);
	if (canonicalJson(approval.signed_release) !== canonicalJson(envelope)) {
		throw new Error('Catalog approval and signed release differ.');
	}
	if (!readFileSync(latestPath).equals(readFileSync(releasePath))) {
		throw new Error('Catalog latest candidate and signed release differ.');
	}
	const latest = await readLatest();
	assertMayPublishSequence(latest, readFileSync(releasePath));
	await requireImmutableReadbacks(
		[...artifactPaths(outputRoot), releasePath, approvalPath],
		outputRoot
	);
	await activateLatest(latest, latestPath);
	console.log(`Activated catalog ${sequence}.`);
}

function requireCommands(commands) {
	for (const command of commands) run(command, ['--version'], process.env, { stdout: 'ignore' });
}

function catalogCheckEnvironment() {
	const environment = { ...process.env };
	delete environment.AWS_OBJECT_LOCK_ENABLED;
	return environment;
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
	const candidate = resolve(repositoryRoot, value ?? `release/${tag}`);
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

function verifySigningKey() {
	const id = requiredEnvironment('CATALOG_SIGNING_KEY_ID');
	const privateKey = requiredEnvironment('CATALOG_SIGNING_PRIVATE_KEY_PEM');
	const keyring = parseJsonFile(join(repositoryRoot, 'keys/catalog-signing-keys.json'));
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
	for (const filename of ['catalog.runtime.json', 'catalog.public.json']) {
		run('gh', [
			'attestation',
			'verify',
			join(proposalRoot, filename),
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
	if (canonicalJson(proposedManifest) !== canonicalJson(expectedManifest)) {
		throw new Error('GitHub Actions and Stogas produced different catalog manifests.');
	}
	for (const filename of ['catalog.runtime.json', 'catalog.public.json']) {
		const local = catalogArtifact(repositoryRoot, filename).bytes;
		const github = readFileSync(join(proposalRoot, filename));
		if (!local.equals(github)) {
			throw new Error(`GitHub Actions and Stogas produced different ${filename} bytes.`);
		}
	}
}

function parseEnvelope(path) {
	const envelope = parseJsonFile(path);
	if (
		envelope?.schema !== 'stogas.catalog.signed.v1' ||
		envelope.manifest?.schema !== 'stogas.catalog.release.v1' ||
		envelope.manifest.sequence !== sequence
	) {
		throw new Error('Generated catalog release is invalid.');
	}
	return envelope;
}

function verifyChecksums(root) {
	const absoluteRoot = resolve(root);
	const seen = new Set();
	for (const line of readFileSync(join(root, 'SHA256SUMS'), 'utf8').trim().split('\n')) {
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
		if (!pathFromRoot || pathFromRoot.startsWith('..') || lstatSync(path).isSymbolicLink()) {
			throw new Error('Release checksum file contains an unsafe path.');
		}
		if (sha256(readFileSync(path)) !== match[1]) {
			throw new Error(`Release checksum failed for ${relativePath}.`);
		}
	}
}

function appendChecksum(root, path) {
	const relativePath = relative(root, path).replaceAll('\\', '/');
	const checksumPath = join(root, 'SHA256SUMS');
	const current = readFileSync(checksumPath, 'utf8').replace(/\s*$/, '\n');
	writeFileSync(checksumPath, `${current}${sha256(readFileSync(path))}  ${relativePath}\n`);
}

function artifactPaths(root) {
	const directory = join(root, 'blobs', 'sha256');
	return readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => join(directory, entry.name))
		.sort();
}

async function publishImmutable(path, root) {
	const key = objectKey(relative(root, path).replaceAll('\\', '/'));
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

async function requireImmutableReadbacks(paths, root) {
	await Promise.all(
		destinations.flatMap((destination) =>
			paths.map(async (path) => {
				const key = objectKey(relative(root, path).replaceAll('\\', '/'));
				const published = await destination.get(key);
				if (!published || !readFileSync(path).equals(published.bytes)) {
					throw new Error(`Catalog object ${key} is absent or different in ${destination.name}.`);
				}
			})
		)
	);
}

function publishGitHubRelease(proposalRoot, releasePath, approvalPath, envelope) {
	const signedReleaseAsset = join(proposalRoot, 'catalog-signed-release.json');
	const approvalAsset = join(proposalRoot, 'catalog-approval.json');
	const checksumAsset = join(proposalRoot, 'STOGAS-SHA256SUMS');
	writeReleaseAsset(signedReleaseAsset, readFileSync(releasePath));
	writeReleaseAsset(approvalAsset, readFileSync(approvalPath));
	writeReleaseAsset(
		checksumAsset,
		Buffer.from(
			[
				`${sha256(readFileSync(signedReleaseAsset))}  ${basename(signedReleaseAsset)}`,
				`${sha256(readFileSync(approvalAsset))}  ${basename(approvalAsset)}`
			].join('\n') + '\n'
		)
	);
	run('gh', [
		'release',
		'upload',
		tag,
		signedReleaseAsset,
		approvalAsset,
		checksumAsset,
		'--clobber',
		'--repo',
		'StogasAI/catalog'
	]);
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
			`Runtime: ${envelope.manifest.runtime}`,
			`Public: ${envelope.manifest.public}`,
			'',
			'GitHub Actions and Stogas independently built the catalog artifacts. The signed approval requires their SHA-256 values to match.'
		].join('\n')
	]);
}

function writeReleaseAsset(path, bytes) {
	if (existsSync(path) && !readFileSync(path).equals(bytes)) {
		throw new Error(`GitHub release ${tag} contains different ${basename(path)} bytes.`);
	}
	writeFileSync(path, bytes);
}

function readSingleAttestation(path) {
	const value = readFileSync(path, 'utf8').trim();
	try {
		const parsed = JSON.parse(value);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
		return parsed;
	} catch {
		const rows = value
			.split(/\r?\n/)
			.filter(Boolean)
			.map((row) => JSON.parse(row));
		if (rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object' || Array.isArray(rows[0])) {
			throw new Error('Catalog release must contain exactly one GitHub attestation bundle.');
		}
		return rows[0];
	}
}

async function readLatest() {
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
	return { bytes: published[0]?.current.bytes, envelope: published[0]?.envelope ?? null, states };
}

function assertMayPublishSequence(latest, releaseBytes) {
	if (latest.envelope?.manifest.sequence > sequence) {
		throw new Error(
			`Catalog latest is already sequence ${latest.envelope.manifest.sequence}; ${sequence} would roll it back.`
		);
	}
	if (
		latest.envelope?.manifest.sequence === sequence &&
		latest.bytes &&
		!releaseBytes.equals(latest.bytes)
	) {
		throw new Error(`Catalog sequence ${sequence} is already bound to different content.`);
	}
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
				if (current.cacheControl === destination.latestCacheControl) return;
			}
			await destination.put(key, bytes, {
				cacheControl: destination.latestCacheControl,
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
		envelope?.schema !== 'stogas.catalog.signed.v1' ||
		envelope.manifest?.schema !== 'stogas.catalog.release.v1' ||
		!Number.isSafeInteger(envelope.manifest?.sequence)
	) {
		throw new Error(`Published catalog latest.json in ${destination} is invalid.`);
	}
	return envelope;
}

async function getR2Object(key) {
	const response = await r2Request('GET', key);
	if (response.status === 404) return null;
	if (!response.ok) {
		const body = await readBoundedResponseText(response, maxErrorBytes).catch(() => '');
		throw new Error(`R2 GET ${key} failed (${response.status}): ${body}`);
	}
	return {
		bytes: await readBoundedResponseBuffer(response, maxObjectBytes),
		cacheControl: response.headers.get('cache-control'),
		etag: r2WriteConditionETag(response.headers.get('etag'))
	};
}

async function putR2Object(key, bytes, options = {}) {
	const headers = {
		'cache-control': options.cacheControl,
		'content-type': 'application/json'
	};
	if (options.ifMatch) headers['if-match'] = options.ifMatch;
	if (options.ifNoneMatch) headers['if-none-match'] = options.ifNoneMatch;
	const response = await r2Request('PUT', key, bytes, headers);
	if (!response.ok) {
		const body = await readBoundedResponseText(response, maxErrorBytes).catch(() => '');
		throw new Error(`R2 PUT ${key} failed (${response.status}): ${body}`);
	}
}

function bucket() {
	return targetBucket || requiredEnvironment('R2_BUCKET');
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
			signal: AbortSignal.timeout(requestTimeoutMs)
		}
	);
	const body = await readBoundedResponseText(response, maxErrorBytes).catch(() => '');
	if (!response.ok) {
		throw new Error(`R2 token verification failed (${response.status}): ${body}`);
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

function parseJsonFile(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

function output(command, args) {
	return run(command, args, process.env, { capture: true }).trim();
}

function run(command, args, env = process.env, options = {}) {
	const result = spawn(command, args, { ...options, env });
	if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}.`);
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
	if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}.`);
	return { status: result.status ?? 1, stdout: result.stdout ?? '' };
}
