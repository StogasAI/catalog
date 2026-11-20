import { spawn } from 'node:child_process';
import {
	existsSync,
	lstatSync,
	mkdtempSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	rmdirSync,
	writeFileSync
} from 'node:fs';
import { availableParallelism, homedir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './canonical-json.mjs';
import { STOGAS_MODES } from './catalog-files.mjs';
import { earliest, partitionCatalog } from './catalog-parts.mjs';
import { CATALOG_PARTS_DIRECTORY, CATALOG_ROOT, catalogFileList } from './release-format.mjs';
import { WORLD, isLocation, isPlaceId, placeIndex } from './locations.mjs';
import { orderModelGroups } from './model-groups.mjs';
import { periodStates } from './periods.mjs';
import { resolvedCatalogChains } from './resolved-chains.mjs';
import { selectorKey } from './selectors.mjs';

const sourceRoot = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const repositoryRoot = join(sourceRoot, '..');
const generatedRoot = join(repositoryRoot, 'generated');
const rootPath = join(generatedRoot, CATALOG_ROOT);
const partsRoot = join(generatedRoot, CATALOG_PARTS_DIRECTORY);
const tempBuildRoot = join(sourceRoot, '.tmp-catalog-build');
const cueVersion = 'v0.16.1';
const toolCacheDir = join(resolveToolCacheRoot(), 'cue', cueVersion);
const cachedCue = join(toolCacheDir, process.platform === 'win32' ? 'cue.exe' : 'cue');
const canonicalEffortOrder = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const canonicalEffortRanks = new Map(canonicalEffortOrder.map((effort, index) => [effort, index]));
const canonicalModalityOrder = ['text', 'image', 'audio', 'video'];
const canonicalModalityRanks = new Map(
	canonicalModalityOrder.map((modality, index) => [modality, index])
);
const canonicalInterfaceRanks = new Map(
	['chat_completions', 'responses'].map((value, index) => [value, index])
);
const reasoningValues = new Set(['unsupported', 'optional', 'required']);
const capabilityNames = [
	'streaming',
	'functionCalling',
	'parallelFunctionCalling',
	'implicitPromptCaching',
	'explicitPromptCaching',
	'structuredOutputs',
	'systemMessages',
	'toolChoice',
	'toolResultImages',
	'toolResultDocuments'
];
const samplingNames = [
	'temperature',
	'topP',
	'topK',
	'frequencyPenalty',
	'presencePenalty',
	'repetitionPenalty',
	'seed',
	'logitBias'
];
const reasoningDefaults = new Set(['none', 'enabled', ...canonicalEffortOrder]);
// Each kind of input that a provider limits, with the limits that it can state in fixed order.
const inputLimitFields = {
	images: ['count', 'bytes', 'totalBytes', 'pixels'],
	documents: ['count', 'bytes', 'totalBytes', 'pages']
};
const dataHandlingFields = [
	'processingLocation',
	'storageLocation',
	'endToEndEncrypted',
	'retentionDays',
	'trainingUse',
	'zeroDataRetention',
	'tee',
	'teeVerified',
	'isolatedPromptCache',
	'sharedWith',
	'certifications'
];
// The audits and authorizations that a record can list, in canonical order, and those that each
// one includes: a FedRAMP High authorization meets Moderate, and a DoD impact level meets the
// levels below it.
const certificationIds = [
	'soc2-type2',
	'iso-27001',
	'iso-27017',
	'iso-27018',
	'iso-27701',
	'iso-42001',
	'pci-dss',
	'csa-star-level-2',
	'hipaa-eligible',
	'fedramp-moderate',
	'fedramp-high',
	'dod-il2',
	'dod-il4',
	'dod-il5'
];
const certificationRanks = new Map(certificationIds.map((value, index) => [value, index]));
const certificationIncludes = {
	'fedramp-high': 'fedramp-moderate',
	'dod-il4': 'dod-il2',
	'dod-il5': 'dod-il4'
};
// Hosted tools in canonical order, and the call meters that each may charge. A request's content
// that a tool reads bills as input tokens, so only web search has call meters.
const hostedToolIds = ['web_search', 'web_fetch', 'mcp'];
const hostedToolRanks = new Map(hostedToolIds.map((value, index) => [value, index]));
const anthropicWebSearchMeters = ['anthropic_web_search_calls'];
const openaiWebSearchMeters = [
	'openai_responses_web_search_calls',
	'openai_responses_web_search_preview_calls',
	'openai_responses_web_search_preview_non_reasoning_calls'
];
const hostedToolMeters = {
	web_search: [...anthropicWebSearchMeters, ...openaiWebSearchMeters],
	web_fetch: [],
	mcp: []
};
// The request names the server that a remote MCP tool sends content to, so the catalog knows no
// fact about it.
const unknownDestination = {
	processingLocation: 'unknown',
	storageLocation: 'unknown',
	retentionDays: null,
	trainingUse: null,
	zeroDataRetention: false,
	endToEndEncrypted: false,
	tee: false,
	teeVerified: false,
	sharedWith: ['unknown']
};
const maxAliasesPerNode = 8;
// Chutes selects an instance of an end-to-end encrypted route by the GPU count that the encrypted
// transport attests, and its other routes take none.
function chutesSelectorKeys(endToEndEncrypted) {
	return endToEndEncrypted ? ['chuteId', 'gpuCount', 'model'] : ['chuteId', 'model'];
}
const nodeIdPattern = /^[a-z0-9][a-z0-9._-]*$/;
const sourceFileSizeLimit = 1024 * 1024;
const processOutputLimit = 128 * 1024 * 1024;
let tempBuildDir = null;

const supportedArgs = new Set(['--check', '--clean', '--validate-only']);

function resolveToolCacheRoot() {
	const configured = process.env.STOGAS_CATALOG_TOOL_CACHE_DIR?.trim();
	if (configured) return configured;
	const xdgCache = process.env.XDG_CACHE_HOME?.trim();
	if (xdgCache) return join(xdgCache, 'stogas', 'catalog-tools');
	const home = homedir();
	if (home) return join(home, '.cache', 'stogas', 'catalog-tools');
	throw new Error(
		'Set STOGAS_CATALOG_TOOL_CACHE_DIR or HOME so the pinned CUE binary can be cached.'
	);
}

function walkFiles(dir, predicate) {
	const files = [];
	for (const entry of readdirSync(dir).sort()) {
		const path = join(dir, entry);
		const stats = lstatSync(path);
		if (stats.isSymbolicLink()) throw new Error(`${rel(path)} must not be a symbolic link`);
		if (stats.isDirectory()) files.push(...walkFiles(path, predicate));
		else if (!stats.isFile()) throw new Error(`${rel(path)} must be a regular file or directory`);
		else if (predicate(path)) {
			if (stats.size > sourceFileSizeLimit) {
				throw new Error(`${rel(path)} exceeds the ${sourceFileSizeLimit}-byte source file limit`);
			}
			files.push(path);
		}
	}
	return files;
}

function rel(path) {
	return relative(sourceRoot, path);
}

function fileOwnedNodeSource(path) {
	if (!/\.ya?ml$/.test(path)) return null;
	const content = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
	const body = content.replace(/^---[ \t]*(?:\r?\n|$)/, '');
	const match = /^(authors|deployments|groups|models|providers|routes):\s*$/m.exec(body);
	if (!match) return null;
	const id = basename(path).replace(/\.ya?ml$/, '');
	validateNodeId(id, rel(path));
	if (match[1] !== 'deployments') return { type: match[1], id };
	// The provider directory names the deployment's provider, which CUE checks its upstream
	// against.
	const provider = /(?:^|\/)providers\/([^/]+)\/deployments\/[^/]+$/.exec(rel(path))?.[1];
	if (!provider) throw new Error(`${rel(path)}: deployments live in providers/<id>/deployments`);
	return { type: match[1], id, provider };
}

function validateNodeId(id, owner) {
	// unknown is the value of a fact that no source states, so no node takes it as its ID.
	if (!nodeIdPattern.test(id) || id === 'unknown') {
		throw new Error(`${owner}: invalid node ID ${JSON.stringify(id)}`);
	}
}

function fileOwnedNodeBody(path, source) {
	const content = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
	const body = content.replace(/^---[ \t]*(?:\r?\n|$)/, '').trimEnd();
	const lines = body.split(/\r?\n/);
	const firstContentIndex = lines.findIndex((line) => line.trim() && !line.trim().startsWith('#'));
	if (firstContentIndex === -1 || lines[firstContentIndex].trim() !== `${source.type}:`) {
		throw new Error(`${rel(path)} must start with its ${source.type} container`);
	}
	const nested = lines.slice(firstContentIndex + 1);
	for (const line of nested) {
		if (line.trim() && !line.startsWith('  ')) {
			throw new Error(`${rel(path)} has content outside its ${source.type} container`);
		}
	}
	const nodeBody = nested.map((line) => (line.startsWith('  ') ? line.slice(2) : line)).join('\n');
	const firstNodeLine = nodeBody.split(/\r?\n/).find((line) => line.trim());
	if (firstNodeLine?.trim() === `${source.id}:`) {
		throw new Error(`${rel(path)} must not repeat its path-owned node ID`);
	}
	return nodeBody;
}

// CUE's memory grows with the records that one run reads, about 330 KB for each deployment, so
// it reads deployments in batches of this many.
const CUE_DEPLOYMENT_BATCH = 1000;

// Where each inference geography runs inference: Anthropic's, Bedrock's inference profiles' and
// Google Cloud's endpoints'.
const INFERENCE_GEO_PROCESSING = {
	au: 'AU',
	ca: 'CA',
	eu: 'eu',
	global: 'world',
	in: 'IN',
	jp: 'JP',
	us: 'US',
	'us-gov': 'US'
};

// Where each OpenAI data residency endpoint that runs inference in its region keeps processing
// and storage. OpenAI's Europe is the European Economic Area and Switzerland, which only the
// continent contains.
const OPENAI_RESIDENCY_LOCATIONS = {
	ae: 'AE',
	au: 'AU',
	eu: 'europe',
	in: 'IN',
	jp: 'JP',
	us: 'US'
};

// Where each Azure Data Zone keeps processing and storage, by the zone that ends a Data Zone
// deployment type, as us in data_zone_batch_us.
const AZURE_DATA_ZONE_LOCATIONS = { apac: 'apac', eu: 'europe', us: 'US' };

/**
 * The data handling that a deployment's upstream fields and preview status decide, which its record
 * takes without stating it: an inference geography says where inference runs, an OpenAI data
 * residency region also stores there, an Azure Data Zone that Microsoft runs keeps processing and
 * storage in its zone, Microsoft's preview terms, which cover Instant, Flex and the models that
 * Azure lists as previews, let it process and store data in any country and drop its commitments
 * on retention and training, and only some Azure model formats keep prompt caches apart.
 */
function selectedDataHandling(graph, providerId, hosting, { upstream, preview }) {
	const selected = {};
	// Anthropic runs a request that names no geography anywhere in the world.
	const geo = upstream.inferenceGeo ?? (providerId === 'anthropic' ? 'global' : undefined);
	if (providerId === 'openai') {
		if (geo === undefined) return selected;
		selected.processingLocation = OPENAI_RESIDENCY_LOCATIONS[geo];
		selected.storageLocation = OPENAI_RESIDENCY_LOCATIONS[geo];
		return selected;
	}
	if (geo !== undefined) selected.processingLocation = INFERENCE_GEO_PROCESSING[geo];
	if (providerId !== 'azure') return selected;
	const zone = azureDataZone(upstream.deploymentType);
	if (zone && hosting === graph.providers.azure.companyId) {
		if (!Object.hasOwn(AZURE_DATA_ZONE_LOCATIONS, zone))
			throw new Error(`Azure Data Zone ${zone} has no location`);
		selected.processingLocation = AZURE_DATA_ZONE_LOCATIONS[zone];
		selected.storageLocation = AZURE_DATA_ZONE_LOCATIONS[zone];
	}
	if (preview || upstream.deploymentType === 'instant' || upstream.serviceTier === 'flex') {
		selected.processingLocation = 'world';
		selected.storageLocation = 'unknown';
		selected.retentionDays = null;
		selected.trainingUse = null;
	}
	// Microsoft keeps prompt caches apart between subscriptions only for its OpenAI models, and
	// Anthropic between workspaces for Claude. Azure states nothing for the other formats.
	if (upstream.modelFormat !== 'OpenAI' && upstream.modelFormat !== 'Anthropic')
		selected.isolatedPromptCache = false;
	return selected;
}

function azureDataZone(deploymentType) {
	return /^data_zone_(?:standard|batch)_(.+)$/.exec(deploymentType ?? '')?.[1];
}

function azureBatchType(deploymentType) {
	return /^(?:global|data_zone)_batch(?:_|$)/.test(deploymentType ?? '');
}

/**
 * The file-owned records as YAML for CUE: the first file holds every record but deployments, and
 * each further file holds a batch of deployments under their providers.
 */
function writeFileOwnedNodeSources(sources) {
	const grouped = new Map();
	for (const source of sources) {
		const entries = grouped.get(source.type) ?? [];
		if (entries.some((entry) => entry.id === source.id)) {
			throw new Error(`${source.type}.${source.id} is owned by more than one source file`);
		}
		entries.push(source);
		grouped.set(source.type, entries);
	}
	const nodes = (entries, indent) =>
		entries
			.sort((left, right) => left.id.localeCompare(right.id))
			.flatMap((source) => [
				`${indent}${JSON.stringify(source.id)}:`,
				...fileOwnedNodeBody(source.path, source)
					.split(/\r?\n/)
					.map((line) => (line.trim() ? `${indent}  ${line}` : line))
			]);
	const files = [];
	const write = (lines) => {
		const path = join(ensureTempBuildDir(), `file-owned-nodes-${files.length}.yaml`);
		writeFileSync(path, `${lines.join('\n').trimEnd()}\n`);
		files.push(path);
	};
	write(
		[...grouped.entries()]
			.filter(([type]) => type !== 'deployments')
			.sort(([left], [right]) => left.localeCompare(right))
			.flatMap(([type, entries]) => [`${type}:`, ...nodes(entries, '  ')])
	);
	// Batches split providers, since no CUE constraint relates two deployments.
	const deployments = (grouped.get('deployments') ?? []).sort(
		(left, right) => left.provider.localeCompare(right.provider) || left.id.localeCompare(right.id)
	);
	for (let start = 0; start < deployments.length; start += CUE_DEPLOYMENT_BATCH)
		write([
			'deploymentsByProvider:',
			...[
				...Map.groupBy(
					deployments.slice(start, start + CUE_DEPLOYMENT_BATCH),
					(source) => source.provider
				)
			].flatMap(([provider, owned]) => [`  ${JSON.stringify(provider)}:`, ...nodes(owned, '    ')])
		]);
	return files;
}

/** Runs the tasks, at most `limit` at a time, and returns their results in order. */
async function runLimited(tasks, limit) {
	const results = [];
	let next = 0;
	const worker = async () => {
		while (next < tasks.length) {
			const index = next++;
			results[index] = await tasks[index]();
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
	return results;
}

/**
 * The exported source with its deployments in one map, and the provider whose directory holds
 * each deployment. Each deployment's routes must belong to that provider.
 */
function withDeployments(exported) {
	const { deploymentsByProvider = {}, ...graph } = exported.graph;
	const deploymentProviders = new Map();
	const deployments = [];
	for (const [providerId, owned] of Object.entries(deploymentsByProvider))
		for (const [id, deployment] of Object.entries(owned)) {
			for (const routeId of deployment.routeIds) {
				const owner = graph.routes[routeId]?.providerId;
				if (owner && owner !== providerId)
					throw new Error(`${id}: route ${routeId} belongs to ${owner}, not ${providerId}`);
			}
			deployments.push([id, deployment]);
			deploymentProviders.set(id, providerId);
		}
	// In the order that one map of them had.
	graph.deployments = Object.fromEntries(
		deployments.sort(([left], [right]) => left.localeCompare(right))
	);
	return { source: { ...exported, graph }, deploymentProviders };
}

function ensureTempBuildDir() {
	if (tempBuildDir) return tempBuildDir;
	if (existsSync(tempBuildRoot)) {
		const stats = lstatSync(tempBuildRoot);
		if (stats.isSymbolicLink() || !stats.isDirectory()) {
			throw new Error(`${rel(tempBuildRoot)} must be a regular directory`);
		}
	}
	mkdirSync(tempBuildRoot, { recursive: true });
	tempBuildDir = mkdtempSync(join(tempBuildRoot, 'build-'));
	return tempBuildDir;
}

function cleanupTempBuildDir() {
	if (!tempBuildDir) return;
	rmSync(tempBuildDir, { force: true, recursive: true });
	tempBuildDir = null;
	try {
		rmdirSync(tempBuildRoot);
	} catch {
		// Another catalog build may own a sibling directory.
	}
}

function run(command, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command[0], command.slice(1), {
			cwd: sourceRoot,
			env: { ...process.env, ...options.env },
			stdio: ['ignore', 'pipe', 'pipe']
		});
		let stdout = '';
		let stderr = '';
		let outputBytes = 0;
		let outputExceeded = false;
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		const collect = (stream, chunk) => {
			if (outputExceeded) return;
			outputBytes += Buffer.byteLength(chunk);
			if (outputBytes > (options.maxOutputBytes ?? processOutputLimit)) {
				outputExceeded = true;
				child.kill('SIGKILL');
				return;
			}
			if (stream === 'stdout') stdout += chunk;
			else stderr += chunk;
		};
		child.stdout.on('data', (chunk) => collect('stdout', chunk));
		child.stderr.on('data', (chunk) => collect('stderr', chunk));
		child.on('error', reject);
		child.on('close', (code) => {
			if (outputExceeded) {
				reject(new Error(`${command[0]} output exceeded the configured limit`));
				return;
			}
			if (code === 0) resolve(stdout);
			else reject(new Error(`${command.join(' ')} failed\n${stderr || stdout}`));
		});
	});
}

async function commandWorks(command) {
	try {
		await run(command);
		return true;
	} catch {
		return false;
	}
}

async function commandIsPinnedCue(command) {
	try {
		const output = await run([...command, 'version']);
		return new RegExp(`^cue version ${cueVersion.replaceAll('.', '\\.')}$`, 'm').test(output);
	} catch {
		return false;
	}
}

async function resolveCueCommand() {
	const configured = process.env.CUE_BIN?.trim();
	if (configured) {
		if (await commandIsPinnedCue([configured])) return [configured];
		throw new Error(`CUE_BIN must select CUE ${cueVersion}.`);
	}
	if (existsSync(cachedCue) && (await commandIsPinnedCue([cachedCue]))) return [cachedCue];
	if (await commandIsPinnedCue(['cue'])) return ['cue'];
	if (await commandWorks(['go', 'version'])) {
		mkdirSync(toolCacheDir, { recursive: true });
		await run(['go', 'install', `cuelang.org/go/cmd/cue@${cueVersion}`], {
			env: { GOBIN: toolCacheDir }
		});
		if (!(await commandIsPinnedCue([cachedCue]))) {
			throw new Error(`Installed CUE does not match ${cueVersion}.`);
		}
		return [cachedCue];
	}
	throw new Error('CUE is required. Install CUE or Go, or set CUE_BIN.');
}

function same(left, right) {
	return canonicalJson(left) === canonicalJson(right);
}

/**
 * Whether an alias is another name that clients send for the model, compared as requests match
 * IDs. It moves one word of the ID, other than the first, to the other side of the version beside
 * it, as gateways that write Claude models version first send them (`claude-4.5-opus`). Where the
 * author's API serves the name as this model, it can also add or remove the snapshot date as the
 * last part (`gpt-5.5`), or be the model's group whose ID begins the model's (`gpt-5.6` for
 * `gpt-5.6-sol`).
 */
function isModelAlias(modelId, model, alias) {
	const id = selectorKey(modelId);
	const name = selectorKey(alias);
	if (versionSwaps(id.split('-')).includes(name)) return true;
	if (model.snapshot !== null) {
		for (const date of [model.snapshot, model.snapshot.replaceAll('-', '')])
			if (name === `${id}-${date}` || id === `${name}-${date}`) return true;
	}
	return model.groupIds.some(
		(groupId) => selectorKey(groupId) === name && id.startsWith(`${name}-`)
	);
}

/** The spellings of an ID's parts with one word, other than the first, moved across the version beside it. */
function versionSwaps(parts) {
	const version = (part) => /\d/u.test(part);
	const swaps = [];
	for (let start = 1; start < parts.length; start++) {
		if (!version(parts[start]) || version(parts[start - 1])) continue;
		let end = start;
		while (end < parts.length && version(parts[end])) end++;
		const run = parts.slice(start, end);
		if (start > 1)
			swaps.push(
				[...parts.slice(0, start - 1), ...run, parts[start - 1], ...parts.slice(end)].join('-')
			);
		if (end < parts.length)
			swaps.push([...parts.slice(0, start), parts[end], ...run, ...parts.slice(end + 1)].join('-'));
	}
	return swaps;
}

function validDate(value) {
	if (typeof value !== 'string') return false;
	const parsed = new Date(`${value}T00:00:00.000Z`);
	return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function validateRetirementDate(owner, date) {
	if (date !== undefined && !validDate(date))
		throw new Error(`${owner}: retirementDate is invalid`);
}

function isPlainObject(value) {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Missing values inherit, objects merge recursively, and every present scalar,
// array, or null replaces the inherited value.
function mergeFacts(base, override) {
	if (override === undefined) return structuredClone(base);
	if (!isPlainObject(base) || !isPlainObject(override)) return structuredClone(override);
	const merged = structuredClone(base);
	for (const [key, value] of Object.entries(override)) {
		merged[key] = mergeFacts(base[key], value);
	}
	return merged;
}

function rejectRedundantOverride(base, override, owner) {
	// A fact that the base does not state has nothing to repeat.
	if (override === undefined || base === undefined) return;
	if (!isPlainObject(base) || !isPlainObject(override)) {
		if (same(base, override)) throw new Error(`${owner} redundantly repeats its inherited value`);
		return;
	}
	for (const [key, value] of Object.entries(override)) {
		rejectRedundantOverride(base[key], value, `${owner}.${key}`);
	}
}

/**
 * A record's own note as the list that compiled records hold, where each note names the record
 * that states it. A route record also holds its provider's notes, and a deployment record those of
 * its routes and its model, since their facts shape what it serves.
 */
function ownNotes(kind, id, text) {
	return text === undefined ? [] : [{ kind, id, text }];
}

function normalizeSourceGraph(sourceGraph, companies) {
	// An author and a provider take their headquarters from their company.
	const headquarteredCountry = (kind, id, companyId) => {
		if (!Object.hasOwn(companies, companyId))
			throw new Error(`${kind} ${id}: companies does not list ${companyId}`);
		return companies[companyId].headquarteredCountry;
	};
	return {
		groups: Object.fromEntries(
			Object.entries(sourceGraph.groups ?? {}).map(([id, group]) => [
				id,
				{
					...group,
					parentIds: [...(group.parentIds ?? [])].sort(),
					notes: ownNotes('group', id, group.notes)
				}
			])
		),
		authors: Object.fromEntries(
			Object.entries(sourceGraph.authors).map(([id, author]) => [
				id,
				{
					...author,
					headquarteredCountry: headquarteredCountry('author', id, author.companyId),
					aliases: [...(author.aliases ?? [])],
					notes: ownNotes('author', id, author.notes)
				}
			])
		),
		models: Object.fromEntries(
			Object.entries(sourceGraph.models).map(([id, model]) => [
				id,
				{
					...model,
					groupIds: [...(model.groupIds ?? [])].sort(),
					maxInputTokens: model.maxInputTokens ?? model.contextWindowTokens,
					aliases: [...(model.aliases ?? [])],
					capabilities: model.capabilities ?? {},
					knowledgeCutoff: model.knowledgeCutoff ?? null,
					notes: ownNotes('model', id, model.notes),
					reasoning: model.reasoning,
					reasoningEfforts: [...(model.reasoningEfforts ?? [])],
					reasoningEffortsByInterface: model.reasoningEffortsByInterface ?? {},
					reasoningMaxTokens: model.reasoningMaxTokens ?? null,
					reasoningDefault: model.reasoningDefault ?? null,
					sampling: model.sampling ?? {},
					promptCacheMinimumTokens: model.promptCacheMinimumTokens ?? null,
					inputLimits: model.inputLimits ?? {},
					minimumRetentionDays: model.minimumRetentionDays ?? null,
					snapshot: model.snapshot ?? null,
					succeeds: model.succeeds ?? null,
					// The models that name this one in `succeeds`, which no record states.
					successorIds: Object.entries(sourceGraph.models)
						.filter(([, other]) => other.succeeds === id)
						.map(([otherId]) => otherId)
						.sort(),
					weightsUrl: model.weightsUrl ?? null
				}
			])
		),
		providers: Object.fromEntries(
			Object.entries(sourceGraph.providers).map(([id, provider]) => [
				id,
				{
					...provider,
					headquarteredCountry: headquarteredCountry('provider', id, provider.companyId),
					aliases: [...(provider.aliases ?? [])],
					accountOptions: (provider.accountOptions ?? []).map((option) => ({
						...option,
						group: option.group ?? null,
						dataHandling: option.dataHandling ?? {},
						grants: option.grants ?? []
					})),
					// Source states only the guarantees that a provider gives and the companies that it
					// shares requests with.
					dataHandling: {
						zeroDataRetention: false,
						tee: false,
						teeVerified: false,
						isolatedPromptCache: false,
						sharedWith: [],
						certifications: [],
						...provider.dataHandling
					},
					notes: ownNotes('provider', id, provider.notes)
				}
			])
		),
		routes: Object.fromEntries(
			Object.entries(sourceGraph.routes).map(([id, route]) => [
				id,
				{
					...route,
					// Source states document formats only on routes that read some, and end-to-end
					// encryption only on routes that have it.
					documentFormats: route.documentFormats ?? { extensions: [], mediaTypes: [] },
					inputLimits: route.inputLimits ?? {},
					dataHandling: { endToEndEncrypted: false, ...route.dataHandling }
				}
			])
		),
		deployments: sourceGraph.deployments
	};
}

function requireNode(nodes, id, owner) {
	const node = nodes && Object.hasOwn(nodes, id) ? nodes[id] : undefined;
	if (!node) throw new Error(`${owner}: missing referenced node ${id}`);
	return node;
}

function validateCanonicalList(values, ranks, owner) {
	if (!Array.isArray(values) || values.length === 0) {
		throw new Error(`${owner} must not be empty`);
	}
	let previousRank = -1;
	for (const value of values) {
		const rank = ranks.get(value);
		if (rank === undefined || rank <= previousRank) {
			throw new Error(`${owner} must use canonical order without repeats`);
		}
		previousRank = rank;
	}
}

// The companies that a record shares requests with: each one that companies lists, or unknown,
// once, in order.
function validateSharedWith(owner, sharedWith, companies) {
	if (
		sharedWith.some(
			(company, index) =>
				!isCompany(companies, company) || (index > 0 && sharedWith[index - 1] >= company)
		)
	)
		throw new Error(
			`${owner}: sharedWith must list companies that companies lists, or unknown, in order, once each`
		);
}

// The audits that a record lists: each one that the closed list holds, once, in its order, with
// every audit that it includes.
function validateCertifications(owner, certifications) {
	if (certifications.length)
		validateCanonicalList(certifications, certificationRanks, `${owner}: certifications`);
	for (const id of certifications) {
		const included = certificationIncludes[id];
		if (included && !certifications.includes(included))
			throw new Error(`${owner}: certifications lists ${id}, which includes ${included}`);
	}
}

function isCompany(companies, id) {
	return id === 'unknown' || Object.hasOwn(companies, id);
}

function validateDataHandling(owner, value, places, companies) {
	validateSharedWith(owner, value.sharedWith, companies);
	validateCertifications(owner, value.certifications);
	if (
		!isLocation(places, value.processingLocation) ||
		(value.storageLocation !== 'none' && !isLocation(places, value.storageLocation))
	) {
		throw new Error(`${owner}: dataHandling names a place that locations does not list`);
	}
	if (value.teeVerified && !value.tee) {
		throw new Error(`${owner}: verified TEE handling requires TEE processing`);
	}
	// Encryption that ends at an ordinary operator's server does not keep content from it.
	if (value.endToEndEncrypted && !value.tee) {
		throw new Error(`${owner}: end-to-end encryption requires TEE processing`);
	}
	if (
		value.zeroDataRetention &&
		(value.storageLocation !== 'none' || value.retentionDays !== 0 || value.trainingUse !== false)
	) {
		throw new Error(`${owner}: zero data retention conflicts with data handling`);
	}
}

// The certifications that an account option can grant, each to a record that lists the entry
// that it names. No record lists a granted one.
const grantedCertifications = { hipaa: 'hipaa-eligible' };

/**
 * Throws unless each account option of each provider covers routes of the provider, changes a
 * fact, and leaves every record that it reaches valid. Two options that an account can hold
 * together set no fact twice on one route, so their order decides nothing.
 */
function validateAccountOptions(graph, deployments, places, companies) {
	for (const [providerId, { accountOptions }] of Object.entries(graph.providers)) {
		for (const [index, option] of accountOptions.entries()) {
			const owner = `${providerId}.accountOptions.${option.id}`;
			const effect = option.dataHandling;
			const changes = [...Object.keys(effect), ...option.grants];
			if (accountOptions.findIndex(({ id }) => id === option.id) !== index)
				throw new Error(`${owner}: another option has this ID`);
			if (
				option.routes.some(
					(routeId, at) =>
						graph.routes[routeId]?.providerId !== providerId || routeId <= option.routes[at - 1]
				)
			)
				throw new Error(`${owner}: routes must list routes of ${providerId}, in order, once each`);
			if (changes.length === 0) throw new Error(`${owner}: changes nothing`);
			if (
				option.grants.some(
					(id, at) => !Object.hasOwn(grantedCertifications, id) || id <= option.grants[at - 1]
				)
			)
				throw new Error(`${owner}: grants must list granted certifications, in order, once each`);
			for (const other of accountOptions.slice(0, index)) {
				const together = option.group === null || option.group !== other.group;
				const set = [...Object.keys(other.dataHandling), ...other.grants];
				if (
					together &&
					option.routes.some((routeId) => other.routes.includes(routeId)) &&
					changes.some((change) => set.includes(change))
				)
					throw new Error(
						`${owner}: changes what ${other.id} changes on a shared route, so give both one group`
					);
			}
			for (const routeId of option.routes) {
				const records = Object.entries(deployments).filter(([, deployment]) =>
					deployment.routes[routeId]?.accountOptions.includes(option.id)
				);
				if (records.length === 0) throw new Error(`${owner}: reaches no deployment on ${routeId}`);
				for (const [deploymentId, deployment] of records)
					validateDataHandling(
						`${owner} on ${deploymentId}`,
						{ ...deployment.routes[routeId].dataHandling, ...effect },
						places,
						companies
					);
				for (const id of option.grants)
					if (
						!records.some(([, deployment]) =>
							deployment.routes[routeId].dataHandling.certifications.includes(
								grantedCertifications[id]
							)
						)
					)
						throw new Error(
							`${owner}: no deployment on ${routeId} lists ${grantedCertifications[id]}`
						);
			}
		}
	}
}

function providerForDeployment(graph, deploymentId, deployment) {
	const providers = deployment.routeIds.map(
		(routeId) => requireNode(graph.routes, routeId, deploymentId).providerId
	);
	if (new Set(providers).size !== 1) {
		throw new Error(`${deploymentId}: all routes must belong to one provider`);
	}
	return providers[0];
}

// The limits of one request on a route: for each limit, the smallest that the route, the model or
// the deployment states, and null where none states one.
function narrowestInputLimits(...sources) {
	const smallest = (values) => {
		const stated = values.filter((value) => value !== undefined && value !== null);
		return stated.length > 0 ? Math.min(...stated) : null;
	};
	return {
		requestBytes: smallest(sources.map((source) => source.requestBytes)),
		...Object.fromEntries(
			Object.entries(inputLimitFields).map(([kind, fields]) => [
				kind,
				Object.fromEntries(
					fields.map((field) => [field, smallest(sources.map((source) => source[kind]?.[field]))])
				)
			])
		)
	};
}

function validateInputLimits(owner, limits) {
	for (const [kind, value] of Object.entries(limits)) {
		if (kind === 'requestBytes') continue;
		if (!Object.hasOwn(inputLimitFields, kind) || Object.keys(value).length === 0) {
			throw new Error(`${owner}.inputLimits.${kind} states no limit`);
		}
		if (
			value.bytes !== undefined &&
			value.totalBytes !== undefined &&
			value.bytes > value.totalBytes
		) {
			throw new Error(`${owner}.inputLimits.${kind}: one file cannot exceed the total`);
		}
	}
}

function validateSamplingRemovals(owner, sampling) {
	for (const [name, value] of Object.entries(sampling ?? {})) {
		if (!samplingNames.includes(name) || value !== false) {
			throw new Error(`${owner}.sampling.${name} may only remove a sampling parameter`);
		}
	}
}

// What a model or deployment does without a reasoning control must be something that it can do:
// no reasoning only where reasoning is optional, an effort only from its own list, and enabled
// only where it reasons without one.
function validateReasoningDefault(owner, value, reasoning, efforts) {
	if (value === null) return;
	if (!reasoningDefaults.has(value)) throw new Error(`${owner}: invalid reasoningDefault`);
	if (reasoning === 'unsupported') {
		throw new Error(`${owner}: a model without reasoning has no reasoningDefault`);
	}
	if (value === 'none') {
		if (reasoning === 'required') {
			throw new Error(`${owner}: required reasoning cannot default to none`);
		}
		return;
	}
	if (value === 'enabled') {
		if (efforts.length > 0) {
			throw new Error(`${owner}: reasoningDefault names the effort where the model has efforts`);
		}
		return;
	}
	if (!efforts.includes(value)) {
		throw new Error(`${owner}: reasoningDefault ${value} is not one of its reasoning efforts`);
	}
}

// What a deployment serves: facts that hold on all its routes, its prices among them, and for
// each route the facts that combine the route with the model and deployment, such as the hosted
// tools that the route runs for it, with their call prices. Facts of the route alone, such as its
// document formats, stay on the route. A capability needs the route, the model and the deployment.
function servedFacts(graph, model, deployment, hosting) {
	const overrides = deployment.overrides ?? {};
	const contextWindowTokens = overrides.contextWindowTokens ?? model.contextWindowTokens;
	const reasoningEfforts = overrides.reasoningEfforts ?? model.reasoningEfforts;
	const routes = {};
	for (const routeId of [...deployment.routeIds].sort()) {
		const route = graph.routes[routeId];
		// A route that serves one interface passes requests through to that provider API, so a
		// model's shorter effort list for the interface applies there. Routes that translate
		// several interfaces to another API keep the deployment's list.
		const interfaceEfforts =
			route.interfaces.length === 1
				? model.reasoningEffortsByInterface[route.interfaces[0]]
				: undefined;
		const dataHandling = mergeFacts(
			mergeFacts(
				route.dataHandling,
				selectedDataHandling(graph, route.providerId, hosting, deployment)
			),
			overrides.dataHandling ?? {}
		);
		const offers = route.hostedTools.filter(
			(offer) => overrides.hostedTools?.[offer.tool] !== false
		);
		routes[routeId] = {
			// The provider's account options that reach this record: those that cover its route,
			// that the deployment does not remove, and that keep its model's minimum retention.
			accountOptions: graph.providers[route.providerId].accountOptions
				.filter(
					(option) =>
						option.routes.includes(routeId) &&
						overrides.accountOptions?.[option.id] !== false &&
						!(option.dataHandling.retentionDays < model.minimumRetentionDays)
				)
				.map((option) => option.id),
			capabilities: Object.fromEntries(
				capabilityNames.map((name) => [
					name,
					route.capabilities[name] &&
						model.capabilities[name] !== false &&
						overrides.capabilities?.[name] !== false
				])
			),
			dataHandling: Object.fromEntries(
				dataHandlingFields.map((field) => [field, dataHandling[field]])
			),
			hostedTools: Object.fromEntries(
				offers.map((offer) => [
					offer.tool,
					{
						dataHandling: structuredClone(offer.dataHandling),
						pricing: structuredClone(offer.pricing ?? {})
					}
				])
			),
			inputLimits: narrowestInputLimits(
				route.inputLimits,
				model.inputLimits,
				overrides.inputLimits ?? {}
			),
			inputModalities: (overrides.inputModalities ?? model.inputModalities).filter((modality) =>
				route.inputModalities.includes(modality)
			),
			sampling: Object.fromEntries(
				samplingNames.map((name) => [
					name,
					route.sampling[name] &&
						model.sampling[name] !== false &&
						overrides.sampling?.[name] !== false
				])
			),
			reasoningEfforts: reasoningEfforts.filter(
				(effort) => !interfaceEfforts || interfaceEfforts.includes(effort)
			)
		};
	}
	// A deployment whose routes cache no prompts has no shortest cached prompt.
	const cachesPrompts = Object.values(routes).some(
		(route) => route.capabilities.implicitPromptCaching || route.capabilities.explicitPromptCaching
	);
	return {
		contextWindowTokens,
		maxInputTokens: Math.min(overrides.maxInputTokens ?? model.maxInputTokens, contextWindowTokens),
		maxOutputTokens: overrides.maxOutputTokens ?? model.maxOutputTokens,
		outputModalities: [...(overrides.outputModalities ?? model.outputModalities)],
		pricing: structuredClone(deployment.pricing),
		promptCacheMinimumTokens: !cachesPrompts
			? null
			: overrides.promptCacheMinimumTokens === undefined
				? model.promptCacheMinimumTokens
				: overrides.promptCacheMinimumTokens,
		reasoning: overrides.reasoning ?? model.reasoning,
		reasoningDefault:
			overrides.reasoningDefault === undefined
				? model.reasoningDefault
				: overrides.reasoningDefault,
		reasoningMaxTokens:
			overrides.reasoningMaxTokens === undefined
				? model.reasoningMaxTokens
				: overrides.reasoningMaxTokens,
		routes
	};
}

// A route's hosted tools in canonical order, each tool once, with only its own call meters and
// places that locations lists. Each deployment of the route runs those that its overrides keep.
function compileHostedTools(routeId, source, places, companies, certifications) {
	const offers = (source ?? []).map((offer, index) => {
		const owner = `${routeId}.hostedTools[${index}]`;
		if (!hostedToolRanks.has(offer.tool)) throw new Error(`${owner}: unknown tool ${offer.tool}`);
		for (const meter of Object.keys(offer.pricing ?? {})) {
			if (!hostedToolMeters[offer.tool].includes(meter)) {
				throw new Error(`${owner}: ${offer.tool} has no call meter ${meter}`);
			}
		}
		const { processingLocation, storageLocation } = offer.dataHandling ?? {};
		for (const location of [processingLocation, storageLocation]) {
			if (location !== undefined && !isLocation(places, location)) {
				throw new Error(`${owner}: dataHandling names a place that locations does not list`);
			}
		}
		if (offer.dataHandling?.sharedWith)
			validateSharedWith(owner, offer.dataHandling.sharedWith, companies);
		const without = offer.dataHandling?.withoutCertifications;
		if (without) {
			validateCanonicalList(without, certificationRanks, `${owner}.withoutCertifications`);
			if (without.some((id) => !certifications.includes(id)))
				throw new Error(`${owner}: withoutCertifications removes only what its route lists`);
		}
		return {
			tool: offer.tool,
			...(offer.pricing && { pricing: structuredClone(offer.pricing) }),
			dataHandling: structuredClone(offer.dataHandling ?? {})
		};
	});
	offers.sort((left, right) => hostedToolRanks.get(left.tool) - hostedToolRanks.get(right.tool));
	if (new Set(offers.map((offer) => offer.tool)).size !== offers.length) {
		throw new Error(`${routeId}: each hosted tool has one offer`);
	}
	return offers;
}

// Overrides may only narrow what the model and routes offer.
function validateServedFacts(
	graph,
	deploymentId,
	model,
	deployment,
	served,
	anthropicWire,
	places,
	companies
) {
	const overrides = deployment.overrides ?? {};
	if (served.contextWindowTokens > model.contextWindowTokens) {
		throw new Error(`${deploymentId}: context limit may only narrow the model limit`);
	}
	if (served.maxOutputTokens > model.maxOutputTokens) {
		throw new Error(`${deploymentId}: output limit may only narrow the model limit`);
	}
	if (served.maxOutputTokens > served.contextWindowTokens) {
		throw new Error(`${deploymentId}: output limit must fit inside the context window`);
	}
	if (served.maxInputTokens > model.maxInputTokens) {
		throw new Error(`${deploymentId}: input limit may only narrow the model limit`);
	}
	for (const field of ['inputModalities', 'outputModalities']) {
		if (!overrides[field]) continue;
		validateCanonicalList(overrides[field], canonicalModalityRanks, `${deploymentId}: ${field}`);
		for (const modality of overrides[field]) {
			if (!model[field].includes(modality)) {
				throw new Error(`${deploymentId}.overrides.${field} may only remove a modality`);
			}
		}
	}
	for (const [tool, value] of Object.entries(overrides.hostedTools ?? {})) {
		if (!hostedToolRanks.has(tool) || value !== false) {
			throw new Error(`${deploymentId}.overrides.hostedTools.${tool} may only remove a tool`);
		}
	}
	// A provider decides whether its deployment always reasons, never reasons or lets the request
	// choose, as a host's chat template can let a request turn off reasoning that the model's author
	// always uses. No provider gives reasoning to a model that has none.
	if (overrides.reasoning !== undefined && model.reasoning === 'unsupported') {
		throw new Error(`${deploymentId}.overrides.reasoning gives reasoning to a model without it`);
	}
	if (overrides.reasoning === model.reasoning) {
		throw new Error(
			`${deploymentId}.overrides.reasoning does not change what the deployment serves`
		);
	}
	if (
		served.reasoning === 'unsupported' &&
		((overrides.reasoningEfforts ?? model.reasoningEfforts).length > 0 ||
			served.reasoningMaxTokens !== null)
	) {
		throw new Error(`${deploymentId}: unsupported reasoning cannot expose controls`);
	}
	for (const [name, value] of Object.entries(overrides.capabilities ?? {})) {
		if (!capabilityNames.includes(name) || value !== false) {
			throw new Error(
				`${deploymentId}.overrides.capabilities.${name} may only remove a capability`
			);
		}
	}
	validateSamplingRemovals(`${deploymentId}.overrides`, overrides.sampling);
	validateInputLimits(`${deploymentId}.overrides`, overrides.inputLimits ?? {});
	validateReasoningDefault(
		deploymentId,
		served.reasoningDefault,
		served.reasoning,
		overrides.reasoningEfforts ?? model.reasoningEfforts
	);
	if (
		overrides.promptCacheMinimumTokens !== undefined &&
		served.promptCacheMinimumTokens === null &&
		overrides.promptCacheMinimumTokens !== null
	) {
		throw new Error(
			`${deploymentId}: a deployment that caches no prompts has no promptCacheMinimumTokens`
		);
	}
	if (overrides.reasoningEfforts) {
		let previousRank = -1;
		for (const effort of overrides.reasoningEfforts) {
			const rank = canonicalEffortRanks.get(effort);
			if (rank === undefined || rank <= previousRank) {
				throw new Error(
					`${deploymentId}: reasoning efforts must use canonical order without repeats`
				);
			}
			previousRank = rank;
			if (!model.reasoningEfforts.includes(effort)) {
				throw new Error(`${deploymentId}: reasoning effort ${effort} is absent from the model`);
			}
		}
	}
	// A route narrows the efforts to its interface's, and must keep one of a deployment that has
	// some; only an override of [] says that a deployment takes none.
	if ((overrides.reasoningEfforts ?? model.reasoningEfforts).length > 0) {
		for (const [routeId, route] of Object.entries(served.routes)) {
			if (route.reasoningEfforts.length === 0) {
				throw new Error(`${deploymentId}: ${routeId} serves none of its reasoning efforts`);
			}
		}
	}
	const reasoningMaxTokens = served.reasoningMaxTokens;
	if (reasoningMaxTokens && overrides.reasoningMaxTokens) {
		if (!model.reasoningMaxTokens) {
			throw new Error(
				`${deploymentId}: cannot enable a model-unsupported manual reasoning token limit`
			);
		}
		if (reasoningMaxTokens.minimum < model.reasoningMaxTokens.minimum) {
			throw new Error(`${deploymentId}: cannot lower the model manual reasoning token minimum`);
		}
		if (reasoningMaxTokens.maximum > model.reasoningMaxTokens.maximum) {
			throw new Error(`${deploymentId}: cannot raise the model manual reasoning token maximum`);
		}
	}
	if (
		reasoningMaxTokens &&
		(!anthropicWire ||
			reasoningMaxTokens.minimum > reasoningMaxTokens.maximum ||
			reasoningMaxTokens.maximum >= served.maxOutputTokens)
	) {
		throw new Error(`${deploymentId}: invalid manual reasoning token limit`);
	}
	for (const [routeId, route] of Object.entries(served.routes)) {
		validateDataHandling(`${deploymentId} on ${routeId}`, route.dataHandling, places, companies);
		for (const offer of graph.routes[routeId].hostedTools) {
			for (const meter of Object.keys(deployment.pricing)) {
				if (offer.pricing?.[meter]) {
					throw new Error(
						`${deploymentId}.pricing.${meter} repeats the ${offer.tool} price of route ${routeId}`
					);
				}
			}
		}
		if (route.hostedTools.mcp) {
			const { withoutCertifications = [], ...effect } = route.hostedTools.mcp.dataHandling;
			if (
				!same(effect, unknownDestination) ||
				route.dataHandling.certifications.some((id) => !withoutCertifications.includes(id))
			) {
				throw new Error(
					`${deploymentId} on ${routeId}: mcp states every data handling fact as unknown and removes every certification`
				);
			}
		}
		// Each wire charges web search on its own meters, so an offer must price exactly those.
		if (route.hostedTools.web_search) {
			const required = anthropicWire ? anthropicWebSearchMeters : openaiWebSearchMeters;
			if (!same(Object.keys(route.hostedTools.web_search.pricing).sort(), [...required].sort())) {
				throw new Error(
					`${deploymentId} on ${routeId}: web search needs exactly the meters ${required.join(', ')}`
				);
			}
		}
	}
	for (const [meter, rates] of Object.entries(served.pricing)) {
		for (const rate of Object.keys(rates)) {
			const cutoff = /^per_mill_context_gt_([1-9][0-9]*)k$/.exec(rate)?.[1];
			if (cutoff && Number(cutoff) * 1000 >= served.maxInputTokens) {
				throw new Error(`${deploymentId}.pricing.${meter}.${rate} must be below the input limit`);
			}
		}
	}
}

// Every override must change a fact that the deployment serves on at least one route, so the
// source never states a value that the model, a route or its upstream fields already set.
function rejectMaskedOverrides(graph, deploymentId, model, deployment, served, hosting) {
	const overrides = deployment.overrides ?? {};
	const paths = Object.entries(overrides).flatMap(([key, value]) =>
		['accountOptions', 'capabilities', 'dataHandling', 'hostedTools', 'sampling'].includes(key)
			? Object.keys(value).map((name) => [key, name])
			: key === 'inputLimits'
				? Object.entries(value).flatMap(([kind, limit]) =>
						kind === 'requestBytes'
							? [[key, kind]]
							: Object.keys(limit).map((field) => [key, kind, field])
					)
				: [[key]]
	);
	for (const path of paths) {
		const without = structuredClone(deployment);
		let target = without.overrides;
		for (const key of path.slice(0, -1)) target = target[key];
		delete target[path.at(-1)];
		if (same(servedFacts(graph, model, without, hosting), served)) {
			throw new Error(
				`${deploymentId}.overrides.${path.join('.')} does not change what the deployment serves`
			);
		}
	}
}

function validateDocumentFormats(value, owner) {
	if (!isPlainObject(value) || Object.keys(value).sort().join(',') !== 'extensions,mediaTypes') {
		throw new Error(`${owner}: documentFormats requires extensions and mediaTypes`);
	}
	for (const [field, pattern] of [
		['extensions', /^\.[a-z0-9][a-z0-9._+-]*$/],
		['mediaTypes', /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/]
	]) {
		const values = value[field];
		if (
			!Array.isArray(values) ||
			values.some(
				(entry, i) =>
					typeof entry !== 'string' || !pattern.test(entry) || (i > 0 && values[i - 1] >= entry)
			)
		) {
			throw new Error(`${owner}: documentFormats.${field} must be sorted, unique and lowercase`);
		}
	}
	if (value.mediaTypes.length === 0 && value.extensions.length !== 0) {
		throw new Error(`${owner}: documentFormats.extensions require documentFormats.mediaTypes`);
	}
}

/**
 * The catalog: the locations, the base graph, a schedule entry for each instant at which a period
 * starts or ends, and the period index.
 */
export function buildCatalog(source) {
	for (const [kind, nodes] of Object.entries(source.graph)) {
		for (const id of Object.keys(nodes)) validateNodeId(id, kind);
	}
	const locations = compileLocations(source.locations);
	const places = placeIndex(locations);
	const companies = source.companies;
	const { base, states, periods } = periodStates(source.graph);
	const sourceGraphs = [base, ...states.map((state) => state.graph)];
	requireNamedPlaces(places, [...sourceGraphs, companies]);
	const graph = compileGraph(base, places, companies);
	const schedule = [];
	const graphs = [graph];
	for (const state of states) {
		const compiled = compileGraph(state.graph, places, companies);
		graphs.push(compiled);
		addScheduleEntry(schedule, state.start, graph, compiled);
	}
	requireNamedCompanies(companies, graphs);
	return { locations, companies, graph, schedule, periods };
}

/**
 * Throws unless a record names each company, in the base graph or a dated state: as the company
 * of an author or a provider, as a hosting, or as one that requests are shared with.
 */
function requireNamedCompanies(companies, graphs) {
	const named = new Set();
	for (const graph of graphs) {
		for (const kind of ['authors', 'providers'])
			for (const { companyId } of Object.values(graph[kind])) named.add(companyId);
		for (const { hostedTools } of Object.values(graph.routes))
			for (const { dataHandling } of hostedTools)
				for (const company of dataHandling.sharedWith ?? []) named.add(company);
		for (const { hosting, routes } of Object.values(graph.deployments)) {
			named.add(hosting);
			for (const { dataHandling } of Object.values(routes))
				for (const company of dataHandling.sharedWith) named.add(company);
		}
	}
	for (const id of Object.keys(companies))
		if (!named.has(id)) throw new Error(`Company ${id}: no record names it, so remove it`);
}

const PLACE_FIELDS = new Set([
	'accountLocations',
	'headquarteredCountry',
	'processingLocation',
	'storageLocation'
]);

/**
 * Throws unless a record names each country and subdivision or a place inside it, in the base graph
 * or a dated state. The catalog lists the places that data can be in, and a place that nothing can
 * be in would only lengthen every list that offers places. Continents, regions and unions stay,
 * because access policies name them to limit requests by country.
 */
function requireNamedPlaces(places, graphs) {
	const named = new Set();
	const visit = (value) => {
		if (Array.isArray(value)) for (const item of value) visit(item);
		else if (value && typeof value === 'object')
			for (const [key, item] of Object.entries(value)) {
				if (PLACE_FIELDS.has(key))
					for (const place of [item].flat())
						for (const within of places.within.get(place) ?? []) named.add(within);
				else visit(item);
			}
	};
	for (const graph of graphs) visit(graph);
	for (const id of places.within.keys())
		if (!named.has(id) && !places.countries.has(id))
			throw new Error(`Location ${id}: no record names it or a place inside it, so remove it`);
}

const REGION_KINDS = ['continent', 'region', 'union'];
const COUNTRY_ID = /^[A-Z]{2}$/;

/**
 * The locations in order, each with the places that directly contain it. A continent, region or
 * union lists the countries that it covers, and the rest follows from those lists: a country lies
 * in each smallest region that lists it, a region in each smallest region that lists all of its
 * countries and more, and a subdivision in the country of its code. A place that no region holds
 * lies in world. Deriving the parents keeps each region's containment true of all its countries,
 * and not only of the countries that the catalog happens to list.
 */
function compileLocations(source) {
	const entries = Object.entries(source ?? {}).sort(([left], [right]) =>
		left < right ? -1 : left > right ? 1 : 0
	);
	const regions = new Map();
	for (const [id, location] of entries) {
		if (!isPlaceId(id)) throw new Error(`Location ${JSON.stringify(id)} has an invalid ID`);
		// world, countries and subdivisions have IDs of their own form; other places are continents,
		// regions and unions, which only their kind tells apart.
		const { kind, countries } = location;
		const expected =
			id === WORLD
				? 'world'
				: COUNTRY_ID.test(id)
					? 'country'
					: /^[A-Z]{2}-/.test(id)
						? 'subdivision'
						: null;
		if (expected ? kind !== expected : !REGION_KINDS.includes(/** @type {string} */ (kind)))
			throw new Error(`Location ${id}: kind ${kind} does not fit its ID`);
		if (Object.hasOwn(location, 'parentIds'))
			throw new Error(
				`Location ${id}: the places that contain it follow from the countries that regions list, so it lists no parentIds`
			);
		if ((expected === null) !== (countries !== undefined))
			throw new Error(
				`Location ${id}: a continent, region or union lists its countries, and no other place does`
			);
		if (countries === undefined) continue;
		if (
			!Array.isArray(countries) ||
			!countries.length ||
			countries.some(
				(country, index) =>
					!COUNTRY_ID.test(country) || (index > 0 && country <= countries[index - 1])
			)
		)
			throw new Error(`Location ${id}: countries must list ISO 3166-1 codes in order, once each`);
		regions.set(id, new Set(countries));
	}
	const holds = (outer, inner) => [...inner].every((country) => outer.has(country));
	const locations = {};
	for (const [id, location] of entries) {
		const own = regions.get(id);
		let parentIds;
		if (id === WORLD) parentIds = [];
		else if (/^[A-Z]{2}-/.test(id)) parentIds = [id.slice(0, 2)];
		else {
			const holders = [...regions.keys()].filter(
				(other) =>
					other !== id && (own ? holds(regions.get(other), own) : regions.get(other).has(id))
			);
			for (const other of holders)
				if (own && holds(own, regions.get(other)))
					throw new Error(`Locations ${id} and ${other} list the same countries`);
			// Of the regions that hold the place, the smallest: those that hold none of the others.
			const smallest = holders.filter(
				(holder) =>
					!holders.some(
						(other) => other !== holder && holds(regions.get(holder), regions.get(other))
					)
			);
			parentIds = smallest.length ? smallest : [WORLD];
		}
		locations[id] = { ...location, parentIds };
	}
	return locations;
}

/** The files that a build writes: the root, and each part that it names by its SHA-256. */
export function catalogFiles(catalog) {
	const { root, parts } = partitionCatalog(catalog);
	return {
		rootJson: canonicalJson(root),
		parts: new Map(parts.map(({ json, sha256 }) => [`${sha256}.json`, json]))
	};
}

// An entry lists every node that differs from the base graph, so a reader needs only the
// base and the latest entry that has started. Periods cannot add or remove nodes.
function addScheduleEntry(schedule, start, base, state) {
	const graph = {};
	for (const [kind, nodes] of Object.entries(state)) {
		if (!same(Object.keys(nodes).sort(), Object.keys(base[kind]).sort())) {
			throw new Error(`The ${kind} at ${start} differ from the base graph`);
		}
		for (const [id, node] of Object.entries(nodes)) {
			if (!same(node, base[kind][id])) (graph[kind] ??= {})[id] = node;
		}
	}
	if (!same(graph, schedule.at(-1)?.graph ?? {})) schedule.push({ start, graph });
}

function compileGraph(source, places, companies) {
	const sourceGraph = normalizeSourceGraph(source, companies);
	orderModelGroups(sourceGraph.groups);
	for (const [id, group] of Object.entries(sourceGraph.groups)) {
		requireNode(sourceGraph.authors, group.authorId, id);
		for (const parentId of group.parentIds) {
			if (sourceGraph.groups[parentId].authorId !== group.authorId) {
				throw new Error(`Group ${id}: parent ${parentId} belongs to another author`);
			}
		}
	}
	for (const [id, model] of Object.entries(sourceGraph.models)) {
		if (new Set(model.groupIds).size !== model.groupIds.length) {
			throw new Error(`Model ${id}: groupIds must be unique`);
		}
		for (const groupId of model.groupIds) {
			if (requireNode(sourceGraph.groups, groupId, id).authorId !== model.authorId) {
				throw new Error(`Model ${id}: group ${groupId} belongs to another author`);
			}
		}
	}
	// Who runs the models of each route unless a deployment names another hosting. A deployment's
	// record states its hosting, so a route's record does not.
	const hostings = new Map();
	const graph = {
		...sourceGraph,
		routes: Object.fromEntries(
			Object.entries(sourceGraph.routes).map(([routeId, route]) => {
				const provider = requireNode(sourceGraph.providers, route.providerId, routeId);
				validateCanonicalList(route.interfaces, canonicalInterfaceRanks, `${routeId}: interfaces`);
				validateCanonicalList(
					route.inputModalities,
					canonicalModalityRanks,
					`${routeId}: inputModalities`
				);
				validateDocumentFormats(route.documentFormats, routeId);
				validateRetirementDate(routeId, route.retirementDate);
				// A route retires on the date that its provider names for it or for itself.
				const retirementDate = earliest(
					route.retirementDate ?? null,
					provider.retirementDate ?? null
				);
				// A route offers each way of serving that its provider offers and it does not withdraw.
				// The gateway has no batch API, so a batch route offers none and states neither.
				for (const mode of STOGAS_MODES)
					if (route[mode] === false && (provider[mode] !== true || route.batch === true))
						throw new Error(`${routeId}: ${mode} is false already`);
				const modes = Object.fromEntries(
					STOGAS_MODES.map((mode) => [
						mode,
						provider[mode] === true && route[mode] !== false && route.batch !== true
					])
				);
				const { capabilities, sampling } = route;
				validateInputLimits(routeId, route.inputLimits);
				rejectRedundantOverride(
					provider.dataHandling,
					route.dataHandling,
					`${routeId}.dataHandling`
				);
				const dataHandling = mergeFacts(provider.dataHandling, route.dataHandling);
				for (const field of dataHandlingFields) {
					if (!(field in dataHandling)) {
						throw new Error(`${routeId}: dataHandling.${field} is unresolved`);
					}
				}
				validateDataHandling(routeId, dataHandling, places, companies);
				const hostedTools = compileHostedTools(
					routeId,
					route.hostedTools,
					places,
					companies,
					dataHandling.certifications
				);
				// The provider's company runs the models of a route that names no other hosting.
				// A managed account is ours, and a request must not make the provider call a server
				// that it names in our name, with results whose size no hold bounds.
				if (modes.stogasManaged && hostedTools.some((offer) => offer.tool === 'mcp'))
					throw new Error(`${routeId}: a route with a managed credential offers no mcp tool`);
				// Every customer on our managed account shares its prompt cache.
				if (modes.stogasManaged && dataHandling.isolatedPromptCache)
					throw new Error(`${routeId}: a route with a managed credential shares its prompt cache`);
				if (route.hosting === provider.companyId)
					throw new Error(`${routeId}.hosting redundantly repeats its provider's company`);
				if (route.hosting !== undefined && !isCompany(companies, route.hosting))
					throw new Error(`${routeId}: companies does not list the hosting ${route.hosting}`);
				hostings.set(routeId, route.hosting ?? provider.companyId);
				return [
					routeId,
					{
						providerId: route.providerId,
						endpoint: route.endpoint ?? null,
						interfaces: [...route.interfaces],
						batch: route.batch === true,
						supportsCancellation: route.supportsCancellation === true,
						inputModalities: [...route.inputModalities],
						documentFormats: structuredClone(route.documentFormats),
						inputLimits: narrowestInputLimits(route.inputLimits),
						capabilities: Object.fromEntries(
							capabilityNames.map((name) => [name, capabilities[name] === true])
						),
						sampling: Object.fromEntries(
							samplingNames.map((name) => [name, sampling[name] === true])
						),
						dataHandling: Object.fromEntries(
							dataHandlingFields.map((field) => [field, dataHandling[field]])
						),
						hostedTools,
						retirementDate,
						...modes,
						notes: [...provider.notes, ...ownNotes('route', routeId, route.notes)]
					}
				];
			})
		)
	};
	const selectors = new Map();
	const groupSelectors = new Map();
	const deployments = {};

	function validateQualifierAliases(nodes, kind) {
		const qualifiers = new Map();
		for (const [id, node] of Object.entries(nodes)) {
			validateAliasCount(node.aliases, kind, id);
			for (const qualifier of [id, ...node.aliases]) {
				if (qualifier.trim() !== qualifier || qualifier.includes('/')) {
					throw new Error(`${kind} ${id}: qualifier ${qualifier} is not canonical`);
				}
				const owner = qualifiers.get(selectorKey(qualifier));
				if (owner) {
					throw new Error(`${kind} qualifier ${qualifier} belongs to both ${owner} and ${id}`);
				}
				qualifiers.set(selectorKey(qualifier), id);
			}
		}
	}

	function validateAliasCount(aliases, kind, id) {
		if (aliases.length > maxAliasesPerNode) {
			throw new Error(`${kind} ${id}: select at most ${maxAliasesPerNode} aliases`);
		}
	}

	// An ID alone names a model, by its ID or an alias, or a deployment, and `group:` names a
	// group, so each of the two namespaces holds one owner for each spelling that a request matches.
	function addSelector(namespace, selector, kind, id) {
		if (selector.trim() !== selector || selector.includes('/')) {
			throw new Error(`${kind} ${id}: selector ${selector} is not canonical`);
		}
		const owner = namespace.get(selectorKey(selector));
		if (owner) throw new Error(`${selector} selects both ${owner} and ${kind}:${id}`);
		namespace.set(selectorKey(selector), `${kind}:${id}`);
	}

	validateQualifierAliases(graph.authors, 'author');
	validateQualifierAliases(graph.providers, 'provider');
	for (const [id, { headquarteredCountry: country }] of Object.entries(companies))
		if (!(/^[A-Z]{2}$/.test(country) && places.within.has(country)))
			throw new Error(
				`Company ${id}: headquarteredCountry names a country that locations does not list`
			);
	for (const [providerId, provider] of Object.entries(graph.providers)) {
		const accountLocations = provider.accountLocations ?? [];
		if (
			accountLocations.some(
				(location, index) => !places.within.has(location) || location <= accountLocations[index - 1]
			)
		)
			throw new Error(
				`${providerId}: accountLocations must list places that locations lists, in order, once each`
			);
		validateDataHandling(providerId, provider.dataHandling, places, companies);
		validateRetirementDate(providerId, provider.retirementDate);
	}

	for (const [modelId, model] of Object.entries(graph.models)) {
		validateAliasCount(model.aliases, 'model', modelId);
		requireNode(graph.authors, model.authorId, modelId);
		if (model.maxInputTokens > model.contextWindowTokens) {
			throw new Error(`${modelId}: input limit must fit inside the context window`);
		}
		if (model.maxOutputTokens > model.contextWindowTokens) {
			throw new Error(`${modelId}: output limit must fit inside the context window`);
		}
		validateCanonicalList(
			model.inputModalities,
			canonicalModalityRanks,
			`${modelId}: inputModalities`
		);
		validateCanonicalList(
			model.outputModalities,
			canonicalModalityRanks,
			`${modelId}: outputModalities`
		);
		if (!validDate(model.releaseDate)) throw new Error(`${modelId}: releaseDate is invalid`);
		if ((model.openWeights === true) !== (model.weightsUrl !== null)) {
			throw new Error(`${modelId}: state weightsUrl exactly when openWeights is true`);
		}
		if (model.succeeds !== null) {
			const earlier = graph.models[model.succeeds];
			// A version follows an earlier one of its author, so the links form no loop.
			if (
				!earlier ||
				earlier.authorId !== model.authorId ||
				!(earlier.releaseDate < model.releaseDate)
			) {
				throw new Error(
					`${modelId}: succeeds must name a model of the same author that was released earlier`
				);
			}
		}
		for (const field of ['snapshot', 'knowledgeCutoff']) {
			if (model[field] !== null && !validDate(model[field])) {
				throw new Error(`${modelId}: ${field} is invalid`);
			}
		}
		for (const [name, value] of Object.entries(model.capabilities)) {
			if (!capabilityNames.includes(name) || value !== false) {
				throw new Error(`${modelId}.capabilities.${name} may only remove a capability`);
			}
		}
		validateSamplingRemovals(modelId, model.sampling);
		validateInputLimits(modelId, model.inputLimits);
		if (!reasoningValues.has(model.reasoning)) {
			throw new Error(`${modelId}: invalid reasoning value`);
		}
		if (model.reasoningEfforts.length > 0) {
			validateCanonicalList(
				model.reasoningEfforts,
				canonicalEffortRanks,
				`${modelId}: reasoningEfforts`
			);
		}
		for (const [name, efforts] of Object.entries(model.reasoningEffortsByInterface)) {
			const owner = `${modelId}: reasoningEffortsByInterface.${name}`;
			validateCanonicalList(efforts, canonicalEffortRanks, owner);
			if (efforts.some((effort) => !model.reasoningEfforts.includes(effort))) {
				throw new Error(`${owner} must be a subset of reasoningEfforts`);
			}
			if (same(efforts, model.reasoningEfforts)) {
				throw new Error(`${owner} redundantly repeats reasoningEfforts`);
			}
		}
		validateReasoningDefault(
			modelId,
			model.reasoningDefault,
			model.reasoning,
			model.reasoningEfforts
		);
		if (
			model.reasoning === 'unsupported' &&
			(model.reasoningEfforts.length > 0 || model.reasoningMaxTokens !== null)
		) {
			throw new Error(`${modelId}: unsupported reasoning cannot expose controls`);
		}
		if (
			model.reasoningMaxTokens &&
			(model.reasoningMaxTokens.minimum <= 0 ||
				model.reasoningMaxTokens.minimum > model.reasoningMaxTokens.maximum ||
				model.reasoningMaxTokens.maximum >= model.maxOutputTokens)
		) {
			throw new Error(`${modelId}: invalid manual reasoning token bounds`);
		}
		addSelector(selectors, modelId, 'model', modelId);
		for (const alias of model.aliases) {
			if (selectorKey(alias) === selectorKey(modelId)) {
				throw new Error(
					`${modelId}: alias ${alias} only respells the ID, which requests match with case ignored and dots and underscores read as hyphens`
				);
			}
			if (!isModelAlias(modelId, model, alias)) {
				throw new Error(
					`${modelId}: alias ${alias} must move one word of the ID across its version, add or remove its snapshot date, or name its group whose ID begins the ID`
				);
			}
			addSelector(selectors, alias, 'model', modelId);
		}
	}
	for (const groupId of Object.keys(graph.groups))
		addSelector(groupSelectors, groupId, 'group', groupId);

	for (const [deploymentId, sourceDeployment] of Object.entries(graph.deployments)) {
		const deployment = structuredClone(sourceDeployment);
		const model = requireNode(graph.models, deployment.modelId, deploymentId);
		const providerId = providerForDeployment(graph, deploymentId, deployment);
		// The gateway serves each interface of a deployment through one route.
		const interfaces = deployment.routeIds.flatMap((routeId) => graph.routes[routeId].interfaces);
		if (new Set(interfaces).size !== interfaces.length) {
			throw new Error(`${deploymentId}: routes must serve different interfaces`);
		}
		if (!deployment.upstream?.model) {
			throw new Error(`${deploymentId}: upstream model is required`);
		}
		// Its routes say who runs it unless it names its own hosting, which it must when they differ.
		const providerCompany = graph.providers[providerId].companyId;
		const routeHostings = [...new Set(deployment.routeIds.map((routeId) => hostings.get(routeId)))];
		if (deployment.hosting === undefined && routeHostings.length > 1)
			throw new Error(`${deploymentId}: its routes name different hostings, so name its own`);
		if (routeHostings.length === 1 && deployment.hosting === routeHostings[0])
			throw new Error(`${deploymentId}.hosting redundantly repeats its route's hosting`);
		if (deployment.hosting !== undefined && !isCompany(companies, deployment.hosting))
			throw new Error(`${deploymentId}: companies does not list the hosting ${deployment.hosting}`);
		const hosting = deployment.hosting ?? routeHostings[0];
		validateRetirementDate(deploymentId, deployment.retirementDate);
		// A deployment retires on its own date, or once every route that serves it has retired.
		const routeDates = deployment.routeIds.map(
			(routeId) => graph.routes[routeId].retirementDate ?? null
		);
		const retirementDate = earliest(
			deployment.retirementDate ?? null,
			routeDates.includes(null)
				? null
				: routeDates.reduce((later, date) => (date > later ? date : later))
		);
		if (retirementDate !== null && retirementDate < model.releaseDate) {
			throw new Error(`${deploymentId}: retirementDate precedes model releaseDate`);
		}
		// A deployment's token prices hold on all of its routes, and a batch API bills its own, so a
		// batch deployment serves only batch routes and names no service tier.
		const batch = deployment.routeIds.map((routeId) => graph.routes[routeId].batch === true);
		if (new Set(batch).size > 1) {
			throw new Error(`${deploymentId}: split the batch routes from the others`);
		}
		// Stogas serves a deployment in the same ways on every route, so the gateway loads whole
		// records, and a deployment withdraws only a way that its routes offer.
		const modes = Object.fromEntries(
			STOGAS_MODES.map((mode) => {
				const offered = new Set(deployment.routeIds.map((routeId) => graph.routes[routeId][mode]));
				if (offered.size > 1)
					throw new Error(`${deploymentId}: split the routes that offer ${mode} from the others`);
				const [routes] = offered;
				if (deployment[mode] === false && !routes)
					throw new Error(`${deploymentId}: ${mode} is false already`);
				return [mode, routes && deployment[mode] !== false];
			})
		);
		const stogasServes = modes.stogasByok || modes.stogasManaged;
		// Routes of one provider repeat its notes, so each note shows once, in route order.
		const notes = [
			...new Map(
				deployment.routeIds
					.flatMap((routeId) => graph.routes[routeId].notes)
					.map((note) => [`${note.kind}:${note.id}`, note])
			).values(),
			...model.notes,
			...ownNotes('deployment', deploymentId, deployment.notes)
		];
		if (batch[0] && deployment.upstream.serviceTier !== undefined) {
			throw new Error(`${deploymentId}: a batch deployment names no service tier`);
		}
		// Azure runs batch jobs only on its batch deployment types, which serve nothing else.
		if (providerId === 'azure' && batch[0] !== azureBatchType(deployment.upstream.deploymentType)) {
			throw new Error(`${deploymentId}: only an Azure batch deployment type serves batch routes`);
		}
		const selectorKeys = Object.keys(deployment.upstream).sort();
		const selectorKeysValid =
			// The gateway sends OpenAI requests to one host, so it serves no data residency endpoint.
			(providerId === 'openai' &&
				(deployment.upstream.inferenceGeo === undefined || !stogasServes) &&
				selectorKeys.every((key) =>
					['inferenceGeo', 'model', 'reasoningMode', 'serviceTier'].includes(key)
				)) ||
			(providerId === 'anthropic' &&
				selectorKeys.every((key) => ['inferenceGeo', 'model', 'serviceTier'].includes(key))) ||
			(providerId === 'chutes' &&
				deployment.routeIds.every(
					(routeId) =>
						JSON.stringify(selectorKeys) ===
						JSON.stringify(chutesSelectorKeys(graph.routes[routeId].dataHandling.endToEndEncrypted))
				)) ||
			(providerId === 'azure' &&
				selectorKeys.includes('deploymentType') &&
				selectorKeys.includes('model') &&
				selectorKeys.includes('modelFormat') &&
				selectorKeys.includes('modelVersion') &&
				selectorKeys.every((key) =>
					[
						'deploymentType',
						'model',
						'modelFormat',
						'modelVersion',
						'reasoningMode',
						'serviceTier'
					].includes(key)
				)) ||
			// Anthropic takes no inference geography for models before Claude 4.6, only global and us
			// for the others, and Fast only where it runs the model itself.
			((providerId === 'aws' || providerId === 'google-cloud') &&
				(hosting === 'anthropic'
					? [undefined, 'global', 'us'].includes(deployment.upstream.inferenceGeo)
					: selectorKeys.includes('inferenceGeo') &&
						deployment.upstream.serviceTier === undefined) &&
				selectorKeys.every((key) => ['inferenceGeo', 'model', 'serviceTier'].includes(key)));
		if (!selectorKeysValid) {
			throw new Error(`${deploymentId}: upstream selector does not match provider ${providerId}`);
		}
		// Azure sells OpenAI tiers as request modes of one deployment, and Claude Fast as its own model.
		if (
			providerId === 'azure' &&
			deployment.upstream.serviceTier &&
			deployment.upstream.modelFormat !== 'OpenAI' &&
			!(
				deployment.upstream.modelFormat === 'Anthropic' &&
				deployment.upstream.serviceTier === 'fast'
			)
		) {
			throw new Error(
				`${deploymentId}: Azure offers service tiers only for OpenAI-format models and Claude Fast`
			);
		}
		// Source omits the standard tier; compiled deployments always name their tier.
		const upstream = {
			...deployment.upstream,
			serviceTier: deployment.upstream.serviceTier ?? 'standard'
		};
		// AWS and Google Cloud serve Claude through Anthropic's Messages API, and other models in
		// OpenAI's format.
		const cloud = providerId === 'aws' || providerId === 'google-cloud';
		const anthropicWire =
			providerId === 'anthropic' ||
			(cloud && model.authorId === 'anthropic') ||
			(providerId === 'azure' && deployment.upstream.modelFormat === 'Anthropic');
		// The GovCloud Regions are a partition of their own, whose accounts the gateway cannot use.
		if (deployment.upstream.inferenceGeo === 'us-gov' && stogasServes) {
			throw new Error(`${deploymentId}: Stogas does not serve the AWS GovCloud (US) Regions`);
		}
		// Bedrock serves these deployments only through inference profiles, whose IDs name the
		// geography and then the model, whose own ID starts with anthropic for Claude.
		if (
			providerId === 'aws' &&
			hosting === providerCompany &&
			!deployment.upstream.model.startsWith(
				`${deployment.upstream.inferenceGeo}.${anthropicWire ? 'anthropic.' : ''}`
			)
		) {
			throw new Error(
				`${deploymentId}: name the ${deployment.upstream.inferenceGeo} inference profile of the model`
			);
		}
		if (
			cloud &&
			deployment.routeIds.some(
				(routeId) => (routeId === 'aws-bedrock-chat-completions') === anthropicWire
			)
		) {
			throw new Error(
				`${deploymentId}: only models other than Claude use the Chat Completions route of ${providerId}`
			);
		}
		if (
			providerId === 'azure' &&
			deployment.routeIds.some(
				(routeId) => (routeId === 'azure-anthropic-messages') !== anthropicWire
			)
		) {
			throw new Error(
				`${deploymentId}: only Azure Anthropic-format models use the Azure Anthropic Messages route`
			);
		}
		if (
			deployment.upstream.reasoningMode &&
			deployment.routeIds.some((routeId) => {
				const routeInterfaces = graph.routes[routeId].interfaces;
				return routeInterfaces.length !== 1 || routeInterfaces[0] !== 'responses';
			})
		) {
			throw new Error(`${deploymentId}: fixed reasoning mode requires Responses-only routes`);
		}
		const served = servedFacts(graph, model, deployment, hosting);
		validateServedFacts(
			graph,
			deploymentId,
			model,
			deployment,
			served,
			anthropicWire,
			places,
			companies
		);
		rejectMaskedOverrides(graph, deploymentId, model, deployment, served, hosting);
		if (
			deployment.preview &&
			(providerId !== 'azure' || hosting !== graph.providers.azure.companyId)
		)
			throw new Error(
				`${deploymentId}.preview names Microsoft's terms for the models that it runs on Azure`
			);
		// Its upstream fields and preview status decide these facts, so an override cannot restate or
		// change them.
		for (const field of Object.keys(selectedDataHandling(graph, providerId, hosting, deployment)))
			if (Object.hasOwn(deployment.overrides?.dataHandling ?? {}, field))
				throw new Error(
					`${deploymentId}.overrides.dataHandling.${field} follows from its upstream fields or preview status`
				);
		// The provider's company and the hosting receive every request, so sharedWith names neither.
		for (const [routeId, route] of Object.entries(served.routes))
			if (route.dataHandling.sharedWith.some((id) => id === providerCompany || id === hosting))
				throw new Error(
					`${deploymentId} on ${routeId}: sharedWith names only companies other than the provider's and the hosting`
				);
		// An audit covers the company that runs the service, so a deployment that another company runs
		// cannot take the list of its provider.
		if (
			hosting !== providerCompany &&
			graph.providers[providerId].dataHandling.certifications.length
		)
			for (const routeId of deployment.routeIds)
				if (
					sourceGraph.routes[routeId].dataHandling.certifications === undefined &&
					deployment.overrides?.dataHandling?.certifications === undefined
				)
					throw new Error(
						`${deploymentId} on ${routeId}: state the certifications of ${hosting}, which runs it`
					);
		// The ID names the provider and model, then each fact that sets the deployment apart from the
		// provider's own standard one: who runs it when not the provider's company, its reasoning
		// mode, its tier or batch API, and the geography or Azure data zone where it runs.
		const { deploymentType, inferenceGeo, reasoningMode, serviceTier } = deployment.upstream;
		const expectedId = [
			providerId,
			deployment.modelId,
			hosting !== providerCompany && `${hosting}-hosted`,
			reasoningMode,
			serviceTier ?? (deploymentType === 'instant' ? 'instant' : batch[0] && 'batch'),
			inferenceGeo !== 'global' && inferenceGeo,
			azureDataZone(deploymentType)
		]
			.filter(Boolean)
			.join('-');
		if (deploymentId !== expectedId) {
			throw new Error(`${deploymentId}: the deployment's facts name it ${expectedId}`);
		}

		addSelector(selectors, deploymentId, 'deployment', deploymentId);

		deployments[deploymentId] = {
			modelId: deployment.modelId,
			hosting,
			upstream,
			approvalRequired: deployment.approvalRequired ?? false,
			// Closed models do not disclose how their weights are stored.
			weightPrecision: deployment.weightPrecision ?? 'unknown',
			retirementDate,
			...modes,
			notes,
			...served
		};
	}

	// A model's developer can require a retention wherever the model runs.
	for (const [deploymentId, deployment] of Object.entries(deployments)) {
		const minimum = graph.models[deployment.modelId].minimumRetentionDays;
		for (const [routeId, { dataHandling }] of Object.entries(deployment.routes))
			if (dataHandling.retentionDays !== null && dataHandling.retentionDays < minimum)
				throw new Error(
					`${deploymentId} on ${routeId}: ${deployment.modelId} requires a retention of ${minimum} days`
				);
	}
	validateAccountOptions(graph, deployments, places, companies);

	// A requested tier moves a model selector to, and the gateway bills a Fast request that the
	// provider ran at Standard at, the one deployment of the model on the same route that matches
	// its hosting and these upstream fields. The provider's model name can differ, as Azure's Claude
	// Fast does.
	const siblingFields = [
		'reasoningMode',
		'modelFormat',
		'modelVersion',
		'deploymentType',
		'inferenceGeo'
	];
	for (const [deploymentId, fast] of Object.entries(deployments)) {
		if (fast.upstream.serviceTier !== 'fast') continue;
		for (const routeId of Object.keys(fast.routes)) {
			// Two Standard deployments that match these fields would share an ID, so one at most does.
			const standard = Object.values(deployments).find(
				(candidate) =>
					candidate.upstream.serviceTier === 'standard' &&
					candidate.modelId === fast.modelId &&
					Object.hasOwn(candidate.routes, routeId) &&
					candidate.hosting === fast.hosting &&
					siblingFields.every((field) => candidate.upstream[field] === fast.upstream[field])
			);
			if (
				!standard ||
				(standard.retirementDate !== null &&
					(fast.retirementDate === null || standard.retirementDate < fast.retirementDate)) ||
				STOGAS_MODES.some((mode) => fast[mode] && !standard[mode])
			) {
				throw new Error(`${deploymentId}: Fast needs a Standard deployment on ${routeId}`);
			}
		}
	}

	// Routes and deployments carry resolved facts, so readers never combine records, and each
	// route record names the hash of its chain. A provider's date, and whether Stogas serves it,
	// are its routes' already.
	const compiled = {
		...sourceGraph,
		providers: Object.fromEntries(
			Object.entries(graph.providers).map(([id, provider]) => {
				const {
					dataHandling: _dataDefaults,
					retirementDate: _routesDate,
					stogasByok: _routesByok,
					stogasManaged: _routesManaged,
					...facts
				} = provider;
				return [id, facts];
			})
		),
		routes: graph.routes,
		deployments
	};
	// A record states every fact, even an empty one, so that a missing field is an error. Notes
	// are not facts: a record without one leaves the field out.
	for (const kind of ['authors', 'groups', 'models', 'providers', 'routes', 'deployments']) {
		compiled[kind] = Object.fromEntries(
			Object.entries(compiled[kind]).map(([id, { notes, ...facts }]) => [
				id,
				notes.length > 0 ? { ...facts, notes } : facts
			])
		);
	}
	for (const { deploymentId, routeId, hash } of resolvedCatalogChains(compiled)) {
		compiled.deployments[deploymentId].routes[routeId].chainHash = hash;
	}
	return compiled;
}

function writeIfChanged(path, content) {
	if (existsSync(path)) {
		const stats = lstatSync(path);
		if (!stats.isFile() || stats.isSymbolicLink())
			throw new Error(`${path} must be a regular artifact file`);
		if (readFileSync(path, 'utf8') === content) return;
	}
	const directory = mkdtempSync(`${path}.tmp-`);
	try {
		const temporary = join(directory, 'artifact');
		writeFileSync(temporary, content);
		renameSync(temporary, path);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

export async function main(argv = process.argv.slice(2)) {
	const args = new Set(argv);
	for (const arg of args) {
		if (!supportedArgs.has(arg)) throw new Error(`Unknown catalog build argument: ${arg}`);
	}
	if (args.has('--clean') && args.size > 1) {
		throw new Error('--clean cannot be combined with another catalog build argument');
	}
	if (args.has('--check') && args.has('--validate-only')) {
		throw new Error('--check and --validate-only cannot be combined');
	}

	if (args.has('--clean')) {
		rmSync(generatedRoot, { force: true, recursive: true });
		rmSync(tempBuildRoot, { force: true, recursive: true });
		return;
	}

	if (existsSync(generatedRoot)) {
		const stats = lstatSync(generatedRoot);
		if (stats.isSymbolicLink() || !stats.isDirectory()) {
			throw new Error(`${relative(repositoryRoot, generatedRoot)} must be a regular directory`);
		}
	}

	const cueFiles = walkFiles(join(sourceRoot, 'cue'), (path) => path.endsWith('.cue')).map(rel);
	const allDataFiles = walkFiles(
		join(sourceRoot, 'data'),
		(path) => path.endsWith('.yaml') || path.endsWith('.yml')
	);
	const fileOwnedSources = allDataFiles
		.map((path) => ({ path, source: fileOwnedNodeSource(path) }))
		.filter(({ source }) => source)
		.map(({ path, source }) => ({ ...source, path }));
	const fileOwnedPaths = new Set(fileOwnedSources.map((source) => source.path));
	const dataFiles = allDataFiles.filter((path) => !fileOwnedPaths.has(path)).map(rel);

	try {
		const [records, ...deploymentBatches] = writeFileOwnedNodeSources(fileOwnedSources);
		const cue = await resolveCueCommand();
		const exportSource = (files) =>
			run([...cue, 'export', ...files, '-e', 'compiledSource', '--out', 'json']);
		const cueRuns = Math.min(4, availableParallelism());
		const [exported, ...batches] = await runLimited(
			[[...dataFiles, rel(records)], ...deploymentBatches.map((batch) => [rel(batch)])].map(
				(files) => async () => JSON.parse(await exportSource([...cueFiles, ...files]))
			),
			cueRuns
		);
		const { source, deploymentProviders } = withDeployments({
			...exported,
			graph: {
				...exported.graph,
				deploymentsByProvider: batches.reduce((merged, { graph }) => {
					for (const [provider, deployments] of Object.entries(graph.deploymentsByProvider))
						Object.assign((merged[provider] ??= {}), deployments);
					return merged;
				}, {})
			}
		});
		// Each dated state must satisfy the same schema as the source. A state differs from the
		// source only in the records that its periods change, so CUE reads those alone.
		const { base, states } = periodStates(source.graph);
		await runLimited(
			states.map((state, index) => () => {
				const changed = {};
				for (const [kind, nodes] of Object.entries(state.graph))
					for (const [id, node] of Object.entries(nodes)) {
						if (node === base[kind][id]) continue;
						const records =
							kind === 'deployments'
								? ((changed.deploymentsByProvider ??= {})[deploymentProviders.get(id)] ??= {})
								: (changed[kind] ??= {});
						records[id] = node;
					}
				const statePath = join(ensureTempBuildDir(), `state-${index}.json`);
				writeFileSync(statePath, JSON.stringify(changed));
				return exportSource([...cueFiles, rel(statePath)]).catch((error) => {
					throw new Error(`The catalog state from ${state.start} is invalid\n${error.message}`);
				});
			}),
			cueRuns
		);
		const { rootJson, parts } = catalogFiles(buildCatalog(source));
		// Checks the root and every part that it names, alone and together.
		catalogFileList(rootJson);

		if (!args.has('--validate-only')) {
			const currentParts = existsSync(partsRoot) ? readdirSync(partsRoot).sort() : [];
			// Files that no longer belong to the build, such as those of an older format.
			const strays = (existsSync(generatedRoot) ? readdirSync(generatedRoot) : []).filter(
				(name) => name !== CATALOG_ROOT && name !== CATALOG_PARTS_DIRECTORY
			);
			if (args.has('--check')) {
				const current = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null);
				if (
					strays.length ||
					current(rootPath) !== rootJson ||
					currentParts.join('\n') !== [...parts.keys()].sort().join('\n') ||
					currentParts.some((name) => current(join(partsRoot, name)) !== parts.get(name))
				) {
					throw new Error('Generated catalog artifacts are stale. Run `bun run build`.');
				}
			} else {
				// Parts first, so a root never names a part that is not there yet.
				mkdirSync(partsRoot, { recursive: true });
				for (const [name, json] of parts) writeIfChanged(join(partsRoot, name), json);
				writeIfChanged(rootPath, rootJson);
				for (const name of currentParts)
					if (!parts.has(name)) rmSync(join(partsRoot, name), { force: true });
				for (const name of strays)
					rmSync(join(generatedRoot, name), { force: true, recursive: true });
			}
		}
	} finally {
		cleanupTempBuildDir();
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main();
}
