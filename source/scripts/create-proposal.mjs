import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	catalogArtifact,
	catalogArchive,
	catalogManifest,
	parseSequence,
	resolveDestructiveOutput,
	sha256,
	canonicalJson
} from './release-format.mjs';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const sequence = parseSequence(process.argv[2]);
const outputRoot = resolveDestructiveOutput(repositoryRoot, process.argv[3], {
	allowedRepositoryRoots: ['dist/catalog', 'release-proposal'],
	defaultRelative: 'release-proposal'
});
const manifest = catalogManifest(repositoryRoot, sequence);
const runtime = catalogArtifact(repositoryRoot, 'catalog.runtime.json');
const publicCatalog = catalogArtifact(repositoryRoot, 'catalog.public.json');
const archive = catalogArchive(repositoryRoot);

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });
writeFileSync(join(outputRoot, 'catalog.runtime.json'), runtime.bytes);
writeFileSync(join(outputRoot, 'catalog.public.json'), publicCatalog.bytes);
writeFileSync(join(outputRoot, 'catalog.archive.json'), archive.bytes);
writeFileSync(join(outputRoot, 'catalog-release.json'), canonicalJson(manifest));
writeFileSync(
	join(outputRoot, 'SHA256SUMS'),
	[
		`${sha256(runtime.bytes)}  catalog.runtime.json`,
		`${sha256(publicCatalog.bytes)}  catalog.public.json`,
		`${sha256(archive.bytes)}  catalog.archive.json`,
		`${sha256(canonicalJson(manifest))}  catalog-release.json`
	].join('\n') + '\n'
);
