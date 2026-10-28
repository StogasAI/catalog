import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	CATALOG_ROOT,
	catalogArtifact,
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
const catalog = catalogArtifact(repositoryRoot);

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });
writeFileSync(join(outputRoot, CATALOG_ROOT), catalog.bytes);
writeFileSync(join(outputRoot, 'catalog-release.json'), canonicalJson(manifest));
writeFileSync(
	join(outputRoot, 'SHA256SUMS'),
	[
		`${sha256(catalog.bytes)}  ${CATALOG_ROOT}`,
		`${sha256(canonicalJson(manifest))}  catalog-release.json`
	].join('\n') + '\n'
);
