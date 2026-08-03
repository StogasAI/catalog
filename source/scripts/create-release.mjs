import { createPrivateKey, sign } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	catalogArtifact,
	catalogManifest,
	canonicalJson,
	parseSequence,
	sha256,
	stableJson
} from './release-format.mjs';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const sequence = parseSequence(process.argv[2]);
const outputRoot = process.argv[3] ?? join(repositoryRoot, 'release');
const signingKeyId = requiredEnvironment('CATALOG_SIGNING_KEY_ID');
const signingPrivateKey = requiredEnvironment('CATALOG_SIGNING_PRIVATE_KEY_PEM');

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(join(outputRoot, 'blobs', 'sha256'), { recursive: true });

const runtime = addBlob('catalog.runtime.json');
const publicCatalog = addBlob('catalog.public.json');
const manifest = catalogManifest(repositoryRoot, sequence);
const manifestBytes = canonicalJson(manifest);
const privateKey = createPrivateKey(signingPrivateKey);
if (privateKey.asymmetricKeyType !== 'ed25519') {
	throw new Error('CATALOG_SIGNING_PRIVATE_KEY_PEM must contain an Ed25519 private key.');
}
const signature = sign(
	null,
	Buffer.concat([
		Buffer.from('stogas catalog release v1\n', 'utf8'),
		Buffer.from(manifestBytes, 'utf8')
	]),
	privateKey
).toString('base64url');
const envelope = {
	keyId: signingKeyId,
	manifest,
	schema: 'stogas.catalog.signed.v1',
	signature
};

mkdirSync(join(outputRoot, 'releases'), { recursive: true });
writeFileSync(join(outputRoot, 'releases', `${sequence}.json`), stableJson(envelope));
writeFileSync(join(outputRoot, 'latest.json'), stableJson(envelope));
writeFileSync(
	join(outputRoot, 'SHA256SUMS'),
	[
		`${sha256(stableJson(envelope))}  releases/${sequence}.json`,
		`${runtime.digest.slice('sha256:'.length)}  ${runtime.path}`,
		`${publicCatalog.digest.slice('sha256:'.length)}  ${publicCatalog.path}`
	].join('\n') + '\n'
);

function addBlob(filename) {
	const artifact = catalogArtifact(repositoryRoot, filename);
	const { bytes } = artifact;
	const digest = artifact.digest.slice('sha256:'.length);
	const extension = filename.endsWith('.json') ? '.json' : '';
	const relativePath = `blobs/sha256/${digest}${extension}`;
	writeFileSync(join(outputRoot, relativePath), bytes);
	return {
		digest: `sha256:${digest}`,
		path: relativePath
	};
}

function requiredEnvironment(name) {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`${name} is required.`);
	return value;
}
