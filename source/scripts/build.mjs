import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
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
import { CATALOG_ARCHIVE_SCHEMA, PUBLIC_CATALOG_SCHEMA } from './public-catalog.mjs';
import {
	CATALOG_ARCHIVE_FILE,
	catalogReleasePolicy,
	checkCatalogArtifactSize
} from './release-format.mjs';
import { ancestorGroupIds, orderModelGroups } from './model-groups.mjs';
import { periodStates } from './periods.mjs';
import { resolvedCatalogChains } from './resolved-chains.mjs';

const sourceRoot = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const repositoryRoot = join(sourceRoot, '..');
const generatedRoot = join(repositoryRoot, 'generated');
const runtimePath = join(generatedRoot, 'catalog.runtime.json');
const publicPath = join(generatedRoot, 'catalog.public.json');
const archivePath = join(generatedRoot, CATALOG_ARCHIVE_FILE);
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
	'toolChoice'
];
const dataHandlingFields = [
	'processingLocation',
	'storageLocation',
	'endToEndEncrypted',
	'retentionDays',
	'trainingUse',
	'zeroDataRetention',
	'tee',
	'teeVerified'
];
const canonicalCredentialModes = ['managed', 'byok'];
const canonicalCredentialModeRanks = new Map(
	canonicalCredentialModes.map((value, index) => [value, index])
);
const maxAliasesPerNode = 8;
const nodeIdPattern = /^[a-z0-9][a-z0-9._:-]*$/;
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
	if (!nodeIdPattern.test(id)) {
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

function validDate(value) {
	if (typeof value !== 'string') return false;
	const parsed = new Date(`${value}T00:00:00.000Z`);
	return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
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
	if (override === undefined) return;
	if (!isPlainObject(base) || !isPlainObject(override)) {
		if (same(base, override)) throw new Error(`${owner} redundantly repeats its inherited value`);
		return;
	}
	for (const [key, value] of Object.entries(override)) {
		rejectRedundantOverride(base[key], value, `${owner}.${key}`);
	}
}

function normalizeSourceGraph(sourceGraph) {
	return {
		groups: Object.fromEntries(
			Object.entries(sourceGraph.groups ?? {}).map(([id, group]) => [
				id,
				{
					...group,
					parentIds: [...(group.parentIds ?? [])].sort()
				}
			])
		),
		authors: Object.fromEntries(
			Object.entries(sourceGraph.authors).map(([id, author]) => [
				id,
				{ ...author, aliases: [...(author.aliases ?? [])] }
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
					reasoning: model.reasoning,
					reasoningEfforts: [...(model.reasoningEfforts ?? [])],
					reasoningEffortsByInterface: model.reasoningEffortsByInterface ?? {},
					reasoningMaxTokens: model.reasoningMaxTokens ?? null,
					snapshot: model.snapshot ?? null
				}
			])
		),
		providers: Object.fromEntries(
			Object.entries(sourceGraph.providers).map(([id, provider]) => [
				id,
				{
					...provider,
					aliases: [...(provider.aliases ?? [])],
					credentialModes: [...provider.credentialModes]
				}
			])
		),
		routes: sourceGraph.routes,
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

function validateDataHandling(owner, value) {
	if (value.teeVerified && !value.tee) {
		throw new Error(`${owner}: verified TEE handling requires TEE processing`);
	}
	if (
		value.zeroDataRetention &&
		(value.storageLocation !== 'none' || value.retentionDays !== 0 || value.trainingUse)
	) {
		throw new Error(`${owner}: zero data retention conflicts with data handling`);
	}
}

function validateRouteEndpoint(routeId, endpoint) {
	if (endpoint === undefined) return;
	let url;
	try {
		url = new URL(endpoint);
	} catch {
		throw new Error(`${routeId}: endpoint must be a canonical HTTPS URL`);
	}
	if (
		endpoint !== endpoint.trim() ||
		/\s/.test(endpoint) ||
		url.protocol !== 'https:' ||
		!url.hostname ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	) {
		throw new Error(`${routeId}: endpoint must be a canonical HTTPS URL`);
	}
}

function validateModelDerivation(models) {
	const states = new Map();
	for (const startId of Object.keys(models)) {
		if (states.get(startId) === 'done') continue;
		const stack = [{ id: startId, exit: false }];
		while (stack.length) {
			const item = stack.pop();
			if (item.exit) {
				states.set(item.id, 'done');
				continue;
			}
			if (states.get(item.id) === 'done') continue;
			if (states.get(item.id) === 'visiting') {
				throw new Error(`${startId}: derivedFrom contains a cycle through ${item.id}`);
			}
			states.set(item.id, 'visiting');
			stack.push({ id: item.id, exit: true });
			for (const parentId of [...(models[item.id].derivedFrom ?? [])].reverse()) {
				if (states.get(parentId) === 'visiting') {
					throw new Error(`${startId}: derivedFrom contains a cycle through ${parentId}`);
				}
				if (states.get(parentId) !== 'done') stack.push({ id: parentId, exit: false });
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

// What a deployment serves: facts that hold on all its routes, and for each route the facts
// that combine the route with the model and deployment. Facts of the route alone, such as its
// document formats, stay on the route. A capability needs the route, the model and the deployment.
function servedFacts(graph, model, deployment) {
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
		const dataHandling = mergeFacts(route.dataHandling, overrides.dataHandling ?? {});
		routes[routeId] = {
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
			inputModalities: model.inputModalities.filter((modality) =>
				route.inputModalities.includes(modality)
			),
			pricing: { ...structuredClone(route.pricing), ...structuredClone(deployment.pricing) },
			reasoningEfforts: reasoningEfforts.filter(
				(effort) => !interfaceEfforts || interfaceEfforts.includes(effort)
			)
		};
	}
	return {
		contextWindowTokens,
		maxInputTokens: Math.min(model.maxInputTokens, contextWindowTokens),
		maxOutputTokens: overrides.maxOutputTokens ?? model.maxOutputTokens,
		outputModalities: [...model.outputModalities],
		reasoning: model.reasoning,
		reasoningMaxTokens:
			overrides.reasoningMaxTokens === undefined
				? model.reasoningMaxTokens
				: overrides.reasoningMaxTokens,
		routes
	};
}

// Overrides may only narrow what the model and routes offer.
function validateServedFacts(graph, deploymentId, model, deployment, served, anthropicWire) {
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
	for (const [name, value] of Object.entries(overrides.capabilities ?? {})) {
		if (!capabilityNames.includes(name) || value !== false) {
			throw new Error(
				`${deploymentId}.overrides.capabilities.${name} may only remove a capability`
			);
		}
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
		validateDataHandling(`${deploymentId} on ${routeId}`, route.dataHandling);
		for (const meter of Object.keys(deployment.pricing)) {
			if (graph.routes[routeId].pricing[meter]) {
				throw new Error(`${deploymentId}.pricing.${meter} repeats a price of route ${routeId}`);
			}
		}
		for (const [meter, rates] of Object.entries(route.pricing)) {
			for (const rate of Object.keys(rates)) {
				const cutoff = /^per_mill_context_gt_([1-9][0-9]*)k$/.exec(rate)?.[1];
				if (cutoff && Number(cutoff) * 1000 >= served.maxInputTokens) {
					throw new Error(`${deploymentId}.pricing.${meter}.${rate} must be below the input limit`);
				}
			}
		}
	}
}

// Every override must change a fact that the deployment serves on at least one route, so the
// source never states a value that the model or a route already sets.
function rejectMaskedOverrides(graph, deploymentId, model, deployment, served) {
	const overrides = deployment.overrides ?? {};
	const paths = Object.entries(overrides).flatMap(([key, value]) =>
		key === 'capabilities' || key === 'dataHandling'
			? Object.keys(value).map((name) => [key, name])
			: [[key]]
	);
	for (const path of paths) {
		const without = structuredClone(deployment);
		let target = without.overrides;
		for (const key of path.slice(0, -1)) target = target[key];
		delete target[path.at(-1)];
		if (same(servedFacts(graph, model, without), served)) {
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

export function buildCatalogs(source, archiveThrough) {
	for (const [kind, nodes] of Object.entries(source.graph)) {
		for (const id of Object.keys(nodes)) validateNodeId(id, kind);
	}
	const { base, states, periods } = periodStates(source.graph);
	const compiled = compileGraph(base);
	const runtimeSchedule = [];
	const publicSchedule = [];
	for (const state of states) {
		const stateCompiled = compileGraph(state.graph);
		addScheduleEntry(runtimeSchedule, state.start, compiled.runtime, stateCompiled.runtime);
		addScheduleEntry(publicSchedule, state.start, compiled.public, stateCompiled.public);
	}
	const archived = archivedNodes(
		{ graph: compiled.public, schedule: publicSchedule },
		archiveThrough
	);
	const isArchived = (kind, id) => Object.hasOwn(archived[kind] ?? {}, id);
	const deploymentDates = Object.fromEntries(
		Object.keys(archived.deployments).map((id) => [
			id,
			compiled.public.deployments[id].retirementDate
		])
	);
	return {
		runtime: {
			schema: 'stogas.catalog.runtime.v6',
			graph: withoutArchived(compiled.runtime, archived),
			schedule: activeSchedule(runtimeSchedule, archived),
			// Requests that name an archived deployment or model learn when it retired.
			retired: {
				deployments: deploymentDates,
				models: Object.fromEntries(
					Object.keys(archived.models).map((id) => [id, lastRetirement(compiled.public, id)])
				)
			}
		},
		// The build adds the archive's digest, or null while no record has moved there.
		public: {
			schema: PUBLIC_CATALOG_SCHEMA,
			graph: withoutArchived(compiled.public, archived),
			schedule: activeSchedule(publicSchedule, archived),
			periods: periods.filter(({ kind, id }) => !isArchived(kind, id))
		},
		archive: Object.keys(archived.deployments).length
			? { schema: CATALOG_ARCHIVE_SCHEMA, graph: archived }
			: null
	};
}

/**
 * The deployments that retired on or before `archiveThrough`, and the models whose deployments
 * all did, each as it stood the day before it retired. A model without deployments stays, because
 * it is listed on purpose.
 */
function archivedNodes(catalog, archiveThrough) {
	const { deployments } = catalog.graph;
	const before = (date) => Date.parse(`${date}T00:00:00Z`) - 1;
	const archived = { deployments: {}, models: {} };
	for (const [id, { retirementDate }] of Object.entries(deployments))
		if (retirementDate !== null && retirementDate <= archiveThrough)
			archived.deployments[id] = nodeAt(catalog, 'deployments', id, before(retirementDate));
	const modelDeployments = Map.groupBy(Object.entries(deployments), ([, { modelId }]) => modelId);
	for (const [modelId, entries] of modelDeployments)
		if (entries.every(([id]) => Object.hasOwn(archived.deployments, id)))
			archived.models[modelId] = nodeAt(
				catalog,
				'models',
				modelId,
				before(lastRetirement(catalog.graph, modelId))
			);
	return archived;
}

/** The day that a model retired: the retirement of its last deployment. */
function lastRetirement(graph, modelId) {
	return Object.values(graph.deployments)
		.filter((deployment) => deployment.modelId === modelId)
		.map(({ retirementDate }) => retirementDate)
		.sort()
		.at(-1);
}

/** A node as the latest schedule entry that started by an instant has it. */
function nodeAt({ graph, schedule }, kind, id, at) {
	let node = graph[kind][id];
	for (const entry of schedule) {
		if (Date.parse(entry.start) > at) break;
		node = entry.graph[kind]?.[id] ?? graph[kind][id];
	}
	return node;
}

function withoutArchived(graph, archived) {
	return Object.fromEntries(
		Object.entries(graph).map(([kind, nodes]) => [
			kind,
			archived[kind]
				? Object.fromEntries(
						Object.entries(nodes).filter(([id]) => !Object.hasOwn(archived[kind], id))
					)
				: nodes
		])
	);
}

// Without the archived nodes, an entry can describe the same state as the one before it, or the
// base graph; neither is kept.
function activeSchedule(schedule, archived) {
	const active = [];
	for (const { start, graph } of schedule) {
		const kept = Object.fromEntries(
			Object.entries(withoutArchived(graph, archived)).filter(
				([, nodes]) => Object.keys(nodes).length
			)
		);
		if (!same(kept, active.at(-1)?.graph ?? {})) active.push({ start, graph: kept });
	}
	return active;
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

function compileGraph(source) {
	const sourceGraph = normalizeSourceGraph(source);
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
				validateRouteEndpoint(routeId, route.endpoint);
				validateDocumentFormats(route.documentFormats, routeId);
				const overrides = route.overrides ?? {};
				rejectRedundantOverride(
					provider.capabilities,
					overrides.capabilities,
					`${routeId}.overrides.capabilities`
				);
				const capabilities = mergeFacts(provider.capabilities, overrides.capabilities ?? {});
				const dataHandling = mergeFacts(provider.dataHandling, route.dataHandling);
				for (const field of dataHandlingFields) {
					if (!(field in dataHandling)) {
						throw new Error(`${routeId}: dataHandling.${field} is unresolved`);
					}
				}
				validateDataHandling(routeId, dataHandling);
				return [
					routeId,
					{
						providerId: route.providerId,
						...(route.endpoint && { endpoint: route.endpoint }),
						interfaces: [...route.interfaces],
						inputModalities: [...route.inputModalities],
						documentFormats: structuredClone(route.documentFormats),
						capabilities: Object.fromEntries(
							capabilityNames.map((name) => [name, capabilities[name] === true])
						),
						dataHandling: Object.fromEntries(
							dataHandlingFields.map((field) => [field, dataHandling[field]])
						),
						pricing: route.pricing ?? {}
					}
				];
			})
		)
	};
	const selectors = new Map();
	const runtimeDeployments = {};
	const publicDeployments = {};
	const baseByModelRoute = new Map();
	const deploymentsByModelRoute = new Map();
	for (const [deploymentId, deployment] of Object.entries(graph.deployments)) {
		for (const routeId of deployment.routeIds) {
			const key = `${deployment.modelId}\0${routeId}`;
			const deploymentIds = deploymentsByModelRoute.get(key) ?? [];
			deploymentIds.push(deploymentId);
			deploymentsByModelRoute.set(key, deploymentIds);
		}
	}
	for (const [key, deploymentIds] of deploymentsByModelRoute) {
		if (deploymentIds.length === 1) {
			baseByModelRoute.set(key, deploymentIds[0]);
			continue;
		}
		const [modelId, routeId] = key.split('\0');
		const providerId = requireNode(graph.routes, routeId, modelId).providerId;
		const baseId = `${providerId}-${modelId}`;
		if (!deploymentIds.includes(baseId)) {
			throw new Error(
				`${key.replace('\0', '/')}: multiple deployments require canonical base ${baseId}`
			);
		}
		baseByModelRoute.set(key, baseId);
	}

	function validateQualifierAliases(nodes, kind) {
		const qualifiers = new Map();
		for (const [id, node] of Object.entries(nodes)) {
			validateAliasCount(node.aliases, kind, id);
			for (const qualifier of [id, ...node.aliases]) {
				if (qualifier.trim() !== qualifier || qualifier.includes('/')) {
					throw new Error(`${kind} ${id}: qualifier ${qualifier} is not canonical`);
				}
				const owner = qualifiers.get(qualifier);
				if (owner) {
					throw new Error(`${kind} qualifier ${qualifier} belongs to both ${owner} and ${id}`);
				}
				qualifiers.set(qualifier, id);
			}
		}
	}

	function validateAliasCount(aliases, kind, id) {
		if (aliases.length > maxAliasesPerNode) {
			throw new Error(`${kind} ${id}: select at most ${maxAliasesPerNode} aliases`);
		}
	}

	function addSelector(selector, kind, id) {
		if (selector.trim() !== selector || selector.includes('/')) {
			throw new Error(`${kind} ${id}: selector ${selector} is not canonical`);
		}
		const owner = selectors.get(selector);
		if (owner) throw new Error(`${selector} selects both ${owner} and ${kind}:${id}`);
		selectors.set(selector, `${kind}:${id}`);
	}

	validateQualifierAliases(graph.authors, 'author');
	validateQualifierAliases(graph.providers, 'provider');
	for (const [providerId, provider] of Object.entries(graph.providers)) {
		validateCanonicalList(
			provider.credentialModes,
			canonicalCredentialModeRanks,
			`${providerId}: credentialModes`
		);
		validateDataHandling(providerId, provider.dataHandling);
	}

	for (const [modelId, model] of Object.entries(graph.models)) {
		validateAliasCount(model.aliases, 'model', modelId);
		requireNode(graph.authors, model.authorId, modelId);
		const parents = model.derivedFrom ?? [];
		if (new Set(parents).size !== parents.length) {
			throw new Error(`${modelId}: derivedFrom must not repeat`);
		}
		for (const parentId of parents) requireNode(graph.models, parentId, modelId);
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
		addSelector(modelId, 'model', modelId);
		// An alias that only respells the ID can never come to mean another model.
		for (const alias of model.aliases) {
			if (alias.replaceAll('.', '-') !== modelId.replaceAll('.', '-')) {
				throw new Error(
					`${modelId}: alias ${alias} may differ from the ID only in dots and dashes`
				);
			}
			addSelector(alias, 'model', modelId);
		}
	}
	validateModelDerivation(graph.models);
	// A group selects its newest model, so requests can follow a family without aliases
	// that move between models.
	for (const groupId of Object.keys(graph.groups)) addSelector(groupId, 'group', groupId);

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
		const retirementDate = deployment.retirementDate ?? null;
		if (retirementDate !== null && !validDate(retirementDate)) {
			throw new Error(`${deploymentId}: retirementDate is invalid`);
		}
		if (retirementDate !== null && retirementDate < model.releaseDate) {
			throw new Error(`${deploymentId}: retirementDate precedes model releaseDate`);
		}
		const selectorKeys = Object.keys(deployment.upstream).sort();
		const selectorKeysValid =
			(providerId === 'openai' &&
				selectorKeys.includes('model') &&
				selectorKeys.every((key) => ['model', 'reasoningMode', 'serviceTier'].includes(key))) ||
			(providerId === 'anthropic' &&
				selectorKeys.includes('model') &&
				selectorKeys.every((key) => ['inferenceGeo', 'model', 'serviceTier'].includes(key))) ||
			(providerId === 'chutes' &&
				JSON.stringify(selectorKeys) === JSON.stringify(['chuteId', 'gpuCount', 'model'])) ||
			(providerId === 'azure' &&
				selectorKeys.includes('deploymentType') &&
				selectorKeys.includes('hosting') &&
				selectorKeys.includes('model') &&
				selectorKeys.includes('modelFormat') &&
				selectorKeys.includes('modelVersion') &&
				selectorKeys.every((key) =>
					[
						'deploymentType',
						'hosting',
						'model',
						'modelFormat',
						'modelVersion',
						'reasoningMode',
						'serviceTier'
					].includes(key)
				));
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
		const anthropicWire =
			providerId === 'anthropic' ||
			(providerId === 'azure' && deployment.upstream.modelFormat === 'Anthropic');
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
		const served = servedFacts(graph, model, deployment);
		validateServedFacts(graph, deploymentId, model, deployment, served, anthropicWire);
		rejectMaskedOverrides(graph, deploymentId, model, deployment, served);
		const dataHandlingValues = Object.values(served.routes).map((route) => route.dataHandling);
		if (
			providerId === 'azure' &&
			deployment.upstream.hosting === 'azure' &&
			deployment.upstream.deploymentType.startsWith('data_zone_standard_')
		) {
			const expectedLocations = {
				data_zone_standard_apac: { processing: 'apac', storage: 'apac' },
				data_zone_standard_eu: { processing: 'europe', storage: 'europe' },
				data_zone_standard_us: { processing: 'US', storage: 'US' }
			}[deployment.upstream.deploymentType];
			if (
				!expectedLocations ||
				dataHandlingValues.some(
					(value) =>
						value.processingLocation !== expectedLocations.processing ||
						value.storageLocation !== expectedLocations.storage
				)
			) {
				throw new Error(
					`${deploymentId}: Data Zone Standard must keep processing and storage in its declared location`
				);
			}
		}
		// Microsoft's preview terms drop its data location and retention commitments.
		if (
			providerId === 'azure' &&
			(deployment.upstream.deploymentType === 'instant' ||
				deployment.upstream.serviceTier === 'flex') &&
			dataHandlingValues.some(
				(value) => value.storageLocation !== 'world' || value.retentionDays !== null
			)
		) {
			throw new Error(
				`${deploymentId}: Azure Instant and Flex previews must keep world storage and unknown retention`
			);
		}
		// Anthropic runs inference where the inference_geo it receives says.
		if (
			providerId === 'anthropic' &&
			dataHandlingValues.some(
				(value) =>
					value.processingLocation !== (deployment.upstream.inferenceGeo === 'us' ? 'US' : 'world')
			)
		) {
			throw new Error(`${deploymentId}: processingLocation must match upstream inferenceGeo`);
		}
		const baseStates = deployment.routeIds.map(
			(routeId) => baseByModelRoute.get(`${deployment.modelId}\0${routeId}`) === deploymentId
		);
		if (new Set(baseStates).size !== 1) {
			throw new Error(`${deploymentId}: split deployments whose routes have different bases`);
		}

		addSelector(deploymentId, 'deployment', deploymentId);

		runtimeDeployments[deploymentId] = {
			modelId: deployment.modelId,
			upstream,
			approvalRequired: deployment.approvalRequired ?? false,
			// Closed models do not disclose how their weights are stored.
			weightPrecision: deployment.weightPrecision ?? 'unknown',
			retirementDate,
			...served
		};
		publicDeployments[deploymentId] = structuredClone(runtimeDeployments[deploymentId]);
	}

	// A requested tier moves a model selector to, and the gateway bills a Fast request that the
	// provider ran at Standard at, the one deployment of the model on the same route that matches
	// these upstream fields. The provider's model name can differ, as Azure's Claude Fast does.
	const siblingFields = [
		'reasoningMode',
		'hosting',
		'modelFormat',
		'modelVersion',
		'deploymentType',
		'inferenceGeo'
	];
	for (const [deploymentId, fast] of Object.entries(runtimeDeployments)) {
		if (fast.upstream.serviceTier !== 'fast') continue;
		for (const routeId of Object.keys(fast.routes)) {
			const standards = Object.values(runtimeDeployments).filter(
				(candidate) =>
					candidate.upstream.serviceTier === 'standard' &&
					candidate.modelId === fast.modelId &&
					Object.hasOwn(candidate.routes, routeId) &&
					siblingFields.every((field) => candidate.upstream[field] === fast.upstream[field])
			);
			if (standards.length > 1) {
				throw new Error(`${deploymentId}: Fast matches several Standard deployments on ${routeId}`);
			}
			const [standard] = standards;
			if (
				!standard ||
				(standard.retirementDate !== null &&
					(fast.retirementDate === null || standard.retirementDate < fast.retirementDate))
			) {
				throw new Error(`${deploymentId}: Fast needs a Standard deployment on ${routeId}`);
			}
		}
	}

	const runtimeRoutes = Object.fromEntries(
		Object.entries(graph.routes).map(([id, route]) => [
			id,
			{
				providerId: route.providerId,
				interfaces: route.interfaces,
				documentFormats: route.documentFormats
			}
		])
	);
	const runtimeModelIds = new Set(
		Object.values(runtimeDeployments).map((deployment) => deployment.modelId)
	);
	const runtimeModels = Object.fromEntries(
		Object.entries(graph.models)
			.filter(([id]) => runtimeModelIds.has(id))
			.map(([id, model]) => [
				id,
				{
					authorId: model.authorId,
					aliases: model.aliases,
					// Every group that contains the model, so a group selects its descendants' models.
					groupIds: ancestorGroupIds(graph.groups, model.groupIds).sort(),
					maxOutputTokens: model.maxOutputTokens,
					name: model.name,
					reasoning: model.reasoning,
					reasoningEfforts: model.reasoningEfforts,
					reasoningMaxTokens: model.reasoningMaxTokens,
					releaseDate: model.releaseDate
				}
			])
	);
	const runtimeAuthors = Object.fromEntries(
		Object.entries(graph.authors).map(([id, author]) => [
			id,
			{
				aliases: author.aliases,
				...(author.headquarteredCountry && { headquarteredCountry: author.headquarteredCountry }),
				name: author.name
			}
		])
	);
	const runtimeProviders = Object.fromEntries(
		Object.entries(graph.providers).map(([id, provider]) => [
			id,
			{
				aliases: provider.aliases,
				credentialModes: provider.credentialModes,
				...(provider.headquarteredCountry && {
					headquarteredCountry: provider.headquarteredCountry
				}),
				name: provider.name
			}
		])
	);

	const compiled = {
		runtime: {
			authors: runtimeAuthors,
			models: runtimeModels,
			providers: runtimeProviders,
			routes: runtimeRoutes,
			deployments: runtimeDeployments
		},
		// Routes and deployments carry resolved facts, so readers never combine nodes.
		public: {
			...sourceGraph,
			providers: Object.fromEntries(
				Object.entries(graph.providers).map(([id, provider]) => {
					const { capabilities: _routeDefaults, dataHandling: _dataDefaults, ...facts } = provider;
					return [id, facts];
				})
			),
			routes: graph.routes,
			deployments: publicDeployments
		}
	};
	for (const { deploymentId, routeId, hash } of resolvedCatalogChains(compiled.public)) {
		runtimeDeployments[deploymentId].routes[routeId].chainHash = hash;
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
		const { archive_through: archiveThrough } = catalogReleasePolicy(repositoryRoot);
		const catalogs = buildCatalogs(source, archiveThrough);
		const archiveJson = catalogs.archive && canonicalJson(catalogs.archive);
		const sha256 = (json) => createHash('sha256').update(json).digest('hex');
		catalogs.public.archive = archiveJson && {
			sha256: sha256(archiveJson),
			size: Buffer.byteLength(archiveJson)
		};
		const publicJson = canonicalJson(catalogs.public);
		catalogs.runtime.publicDigest = `sha256:${sha256(publicJson)}`;
		const runtimeJson = canonicalJson(catalogs.runtime);
		checkCatalogArtifactSize('catalog.runtime.json', Buffer.byteLength(runtimeJson));
		checkCatalogArtifactSize('catalog.public.json', Buffer.byteLength(publicJson));
		if (archiveJson) checkCatalogArtifactSize(CATALOG_ARCHIVE_FILE, Buffer.byteLength(archiveJson));

		if (!args.has('--validate-only')) {
			if (args.has('--check')) {
				const current = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null);
				if (
					current(runtimePath) !== runtimeJson ||
					current(publicPath) !== publicJson ||
					current(archivePath) !== archiveJson
				) {
					throw new Error('Generated catalog artifacts are stale. Run `bun run build`.');
				}
			} else {
				mkdirSync(generatedRoot, { recursive: true });
				if (archiveJson) writeIfChanged(archivePath, archiveJson);
				else rmSync(archivePath, { force: true });
				writeIfChanged(runtimePath, runtimeJson);
				writeIfChanged(publicPath, publicJson);
			}
		}
	} finally {
		cleanupTempBuildDir();
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main();
}
