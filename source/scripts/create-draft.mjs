import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const sequence = parseSequence(process.argv[2]);
const channel = requiredEnvironment('CATALOG_CHANNEL');
const minGatewayVersion = requiredEnvironment('CATALOG_MIN_GATEWAY_VERSION');
const sourceCommit = requiredEnvironment('CATALOG_SOURCE_COMMIT');
const createdAt = new Date(requiredEnvironment('CATALOG_DRAFT_CREATED_AT'));
const outputRoot = process.argv[3] ?? join(repositoryRoot, 'draft');

if (!['canary', 'stable'].includes(channel)) {
	throw new Error('CATALOG_CHANNEL must be canary or stable.');
}
if (Number.isNaN(createdAt.valueOf())) {
	throw new Error('CATALOG_DRAFT_CREATED_AT must be an ISO 8601 timestamp.');
}

rmSync(outputRoot, { force: true, recursive: true });
mkdirSync(outputRoot, { recursive: true });

const runtime = copyArtifact('catalog.runtime.json');
const publicCatalog = copyArtifact('catalog.public.json');
writeFileSync(
	join(outputRoot, 'catalog.draft.json'),
	stableJson({
		schema: 'stogas.catalog.draft.v1',
		sequence,
		channel,
		minGatewayVersion,
		createdAt: createdAt.toISOString(),
		source: {
			commit: sourceCommit,
			repository: 'https://github.com/StogasAI/catalog'
		},
		runtime,
		public: publicCatalog
	})
);

function copyArtifact(filename) {
	const bytes = readFileSync(join(repositoryRoot, 'generated', filename));
	writeFileSync(join(outputRoot, filename), bytes);
	return {
		digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
		size: bytes.byteLength
	};
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
