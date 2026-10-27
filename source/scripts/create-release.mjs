import { lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	catalogArchiveArtifact,
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
const blobs = [
	addBlob(catalogArtifact(repositoryRoot, 'catalog.runtime.json')),
	addBlob(catalogArtifact(repositoryRoot, 'catalog.public.json')),
	...[catalogArchiveArtifact(repositoryRoot)].filter(Boolean).map(addBlob)
];

// Control lists this approval in signed evidence; only its artifacts and the archive that the
// public catalog names are published.
writeFileSync(join(outputRoot, 'catalog-approval.json'), canonicalJson(envelope));
writeFileSync(
	join(outputRoot, 'SHA256SUMS'),
	[
		`${sha256(canonicalJson(envelope))}  catalog-approval.json`,
		...blobs.map(({ digest, path }) => `${digest.slice('sha256:'.length)}  ${path}`)
	].join('\n') + '\n'
);

function addBlob({ bytes, digest }) {
	const relativePath = `blobs/sha256/${digest.slice('sha256:'.length)}.json`;
	writeFileSync(join(outputRoot, relativePath), bytes);
	return { digest, path: relativePath };
}
