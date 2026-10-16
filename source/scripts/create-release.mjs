import { lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	catalogArtifact,
	catalogManifest,
	parseCatalogReleaseEvidence,
	parseSequence,
	resolveDestructiveOutput,
	sha256,
	canonicalJson
} from './release-format.mjs';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const sequence = parseSequence(process.argv[2]);
const outputRoot = resolveDestructiveOutput(repositoryRoot, process.argv[3], {
	allowedRepositoryRoots: ['release'],
	defaultRelative: 'release'
});
const attestationPath = process.argv[4];
if (!attestationPath) throw new Error('A build attestation file is required.');
const attestationStat = lstatSync(attestationPath);
if (
	!attestationStat.isFile() ||
	attestationStat.isSymbolicLink() ||
	attestationStat.size > 1024 * 1024
) {
	throw new Error('Build attestation must be a bounded regular file.');
}
const attestation = JSON.parse(readFileSync(attestationPath, 'utf8'));
if (!attestation || typeof attestation !== 'object' || Array.isArray(attestation)) {
	throw new Error('Exactly one build attestation is required.');
}
const envelope = parseCatalogReleaseEvidence({
	document: catalogManifest(repositoryRoot, sequence),
	provenance: attestation
});

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(join(outputRoot, 'blobs', 'sha256'), { recursive: true });
const runtime = addBlob('catalog.runtime.json');
const publicCatalog = addBlob('catalog.public.json');

mkdirSync(join(outputRoot, 'releases'), { recursive: true });
writeFileSync(join(outputRoot, 'releases', `${sequence}.json`), canonicalJson(envelope));
writeFileSync(join(outputRoot, 'latest.json'), canonicalJson(envelope));
writeFileSync(
	join(outputRoot, 'SHA256SUMS'),
	[
		`${sha256(canonicalJson(envelope))}  releases/${sequence}.json`,
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
