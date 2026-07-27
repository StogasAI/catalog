import { createHash, createPrivateKey, sign } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const sequence = parseSequence(process.argv[2]);
const outputRoot = process.argv[3] ?? join(repositoryRoot, 'release');
const sourceCommit = requiredEnvironment('CATALOG_SOURCE_COMMIT');
const sourceTimestamp = requiredEnvironment('CATALOG_SOURCE_TIMESTAMP');
const minGatewayVersion = requiredEnvironment('CATALOG_MIN_GATEWAY_VERSION');
const signingKeyId = requiredEnvironment('CATALOG_SIGNING_KEY_ID');
const signingPrivateKey = requiredEnvironment('CATALOG_SIGNING_PRIVATE_KEY_PEM');
const createdAt = new Date(sourceTimestamp);

if (Number.isNaN(createdAt.valueOf())) {
	throw new Error('CATALOG_SOURCE_TIMESTAMP must be an ISO 8601 timestamp.');
}

const expiresAt = new Date(createdAt);
expiresAt.setUTCDate(expiresAt.getUTCDate() + 30);

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(join(outputRoot, 'blobs', 'sha256'), { recursive: true });

const runtime = addBlob('catalog.runtime.json');
const publicCatalog = addBlob('catalog.public.json');
const manifest = {
	schema: 'stogas.catalog.release.v1',
	sequence,
	catalogSchema: 2,
	createdAt: createdAt.toISOString(),
	expiresAt: expiresAt.toISOString(),
	minGatewayVersion,
	source: {
		commit: sourceCommit,
		repository: 'https://github.com/StogasAI/catalog'
	},
	runtime,
	public: publicCatalog
};
const manifestBytes = stableJson(manifest);
const privateKey = createPrivateKey(signingPrivateKey);
if (privateKey.asymmetricKeyType !== 'ed25519') {
	throw new Error('CATALOG_SIGNING_PRIVATE_KEY_PEM must contain an Ed25519 private key.');
}
const signature = sign(null, Buffer.from(manifestBytes), privateKey).toString('base64');
const envelope = {
	schema: 'stogas.catalog.signed.v1',
	manifest,
	signature: {
		algorithm: 'Ed25519',
		keyId: signingKeyId,
		value: signature
	}
};

mkdirSync(join(outputRoot, 'releases'), { recursive: true });
writeFileSync(join(outputRoot, 'releases', `${sequence}.json`), stableJson(envelope));
writeFileSync(join(outputRoot, 'channel.json'), stableJson(envelope));
writeFileSync(
	join(outputRoot, 'SHA256SUMS'),
	[
		`${sha256(stableJson(envelope))}  releases/${sequence}.json`,
		`${runtime.digest.slice('sha256:'.length)}  ${runtime.path}`,
		`${publicCatalog.digest.slice('sha256:'.length)}  ${publicCatalog.path}`
	].join('\n') + '\n'
);

function addBlob(filename) {
	const sourcePath = join(repositoryRoot, 'generated', filename);
	const bytes = readFileSync(sourcePath);
	const digest = sha256(bytes);
	const extension = filename.endsWith('.json') ? '.json' : '';
	const relativePath = `blobs/sha256/${digest}${extension}`;
	writeFileSync(join(outputRoot, relativePath), bytes);
	return {
		digest: `sha256:${digest}`,
		mediaType: 'application/json',
		path: relativePath,
		size: bytes.byteLength
	};
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

function stableJson(value) {
	return `${JSON.stringify(stableValue(value))}\n`;
}

function stableValue(value) {
	if (Array.isArray(value)) return value.map(stableValue);
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map((key) => [key, stableValue(value[key])])
	);
}
