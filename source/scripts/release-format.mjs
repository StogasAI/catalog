import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

export function catalogManifest(repositoryRoot, sequenceInput) {
	const sequence = parseSequence(sequenceInput);
	const source = {
		commit: git(repositoryRoot, ['rev-parse', 'HEAD']),
		repository: 'https://github.com/StogasAI/catalog',
		tag: `catalog-v${sequence}`,
		tree: git(repositoryRoot, ['rev-parse', 'HEAD^{tree}'])
	};
	return {
		catalogSchema: 1,
		public: catalogArtifact(repositoryRoot, 'catalog.public.json').digest,
		runtime: catalogArtifact(repositoryRoot, 'catalog.runtime.json').digest,
		schema: 'stogas.catalog.release.v1',
		sequence,
		source
	};
}

export function catalogArtifact(repositoryRoot, filename) {
	const bytes = readFileSync(join(repositoryRoot, 'generated', filename));
	return { bytes, digest: `sha256:${sha256(bytes)}` };
}

export function parseSequence(value) {
	if (!/^[1-9][0-9]*$/.test(value ?? '')) {
		throw new Error('Release sequence must be a positive decimal integer.');
	}
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed)) {
		throw new Error('Release sequence exceeds the safe integer range.');
	}
	return parsed;
}

export function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

export function stableJson(value) {
	return `${canonicalJson(value)}\n`;
}

export function canonicalJson(value) {
	return JSON.stringify(stableValue(value));
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

function git(repositoryRoot, args) {
	return execFileSync('git', args, {
		cwd: repositoryRoot,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'inherit']
	}).trim();
}
