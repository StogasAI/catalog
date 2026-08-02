import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	catalogArtifact,
	catalogManifest,
	parseSequence,
	sha256,
	stableJson
} from './release-format.mjs';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const sequence = parseSequence(process.argv[2]);
const outputRoot = process.argv[3] ?? join(repositoryRoot, 'release-proposal');
const manifest = catalogManifest(repositoryRoot, sequence);
const runtime = catalogArtifact(repositoryRoot, 'catalog.runtime.json');
const publicCatalog = catalogArtifact(repositoryRoot, 'catalog.public.json');

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });
writeFileSync(join(outputRoot, 'catalog.runtime.json'), runtime.bytes);
writeFileSync(join(outputRoot, 'catalog.public.json'), publicCatalog.bytes);
writeFileSync(join(outputRoot, 'catalog-release.json'), stableJson(manifest));
writeFileSync(
	join(outputRoot, 'SHA256SUMS'),
	[
		`${sha256(runtime.bytes)}  catalog.runtime.json`,
		`${sha256(publicCatalog.bytes)}  catalog.public.json`,
		`${sha256(stableJson(manifest))}  catalog-release.json`
	].join('\n') + '\n'
);
