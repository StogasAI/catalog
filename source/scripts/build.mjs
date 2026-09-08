import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	existsSync,
	lstatSync,
	mkdtempSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	rmdirSync,
	writeFileSync
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stableJson } from './canonical-json.mjs';

const sourceRoot = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const repositoryRoot = join(sourceRoot, '..');
const generatedRoot = join(repositoryRoot, 'generated');
const runtimePath = join(generatedRoot, 'catalog.runtime.json');
const publicPath = join(generatedRoot, 'catalog.public.json');
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
const canonicalCredentialModes = ['managed', 'byok'];
const canonicalCredentialModeRanks = new Map(
	canonicalCredentialModes.map((value, index) => [value, index])
);
const maxAliasesPerNode = 8;
const runtimeSizeLimit = 16 * 1024 * 1024;
const publicSizeLimit = 64 * 1024 * 1024;
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
	const match = /^(authors|deployments|models|providers|routes):\s*$/m.exec(body);
	return match ? { type: match[1], id: basename(path).replace(/\.ya?ml$/, '') } : null;
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

function writeFileOwnedNodeSource(sources) {
	if (!sources.length) return null;
	const grouped = new Map();
	for (const source of sources) {
		const entries = grouped.get(source.type) ?? [];
		if (entries.some((entry) => entry.id === source.id)) {
			throw new Error(`${source.type}.${source.id} is owned by more than one source file`);
		}
		entries.push(source);
		grouped.set(source.type, entries);
	}
	const content = [...grouped.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.flatMap(([type, entries]) => [
			`${type}:`,
			...entries
				.sort((left, right) => left.id.localeCompare(right.id))
				.flatMap((source) => [
					`  ${source.id}:`,
					...fileOwnedNodeBody(source.path, source)
						.split(/\r?\n/)
						.map((line) => (line.trim() ? `    ${line}` : line))
				])
		])
		.join('\n');
	const generatedPath = join(ensureTempBuildDir(), 'file-owned-nodes.yaml');
	writeFileSync(generatedPath, `${content.trimEnd()}\n`);
	return generatedPath;
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
	return stableJson(left) === stableJson(right);
}

function validDate(value) {
	if (typeof value !== 'string') return false;
	const parsed = new Date(`${value}T00:00:00.000Z`);
	return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function validDeprecationDate(value) {
	if (value === null) return true;
	return validDate(value);
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
					aliases: [...(model.aliases ?? [])],
					capabilities: model.capabilities ?? {},
					deprecationDate: model.deprecationDate ?? null,
					flavors: [...(model.flavors ?? [])],
					knowledgeCutoff: model.knowledgeCutoff ?? null,
					reasoning: model.reasoning,
					reasoningEfforts: [...model.reasoningEfforts],
					reasoningMaxTokens: model.reasoningMaxTokens,
					releaseDate: model.releaseDate ?? null,
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
	const node = nodes?.[id];
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

function oneRouteFact(graph, deploymentId, deployment, field) {
	const facts = deployment.routeIds.map(
		(routeId) => requireNode(graph.routes, routeId, deploymentId)[field]
	);
	const first = facts[0];
	for (const fact of facts.slice(1)) {
		if (!same(first, fact)) {
			throw new Error(`${deploymentId}: route ${field} differs; split the deployment`);
		}
	}
	return structuredClone(first);
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

function mergePricing(graph, deploymentId, deployment) {
	const pricing = {};
	for (const routeId of deployment.routeIds) {
		const route = requireNode(graph.routes, routeId, deploymentId);
		for (const [meter, rates] of Object.entries(route.pricing ?? {})) {
			if (pricing[meter] && !same(pricing[meter], rates)) {
				throw new Error(`${deploymentId}: route pricing conflicts for ${meter}`);
			}
			pricing[meter] = structuredClone(rates);
		}
	}
	rejectRedundantOverride(
		pricing,
		deployment.overrides?.pricing,
		`${deploymentId}.overrides.pricing`
	);
	const inheritedPricing = mergeFacts(pricing, deployment.overrides?.pricing ?? {});
	for (const meter of Object.keys(deployment.pricing)) {
		if (inheritedPricing[meter]) {
			throw new Error(`${deploymentId}.pricing.${meter} must use overrides.pricing`);
		}
	}
	return mergeFacts(inheritedPricing, deployment.pricing);
}

function effectiveTokenLimits(deploymentId, model, deployment) {
	const overrides = deployment.overrides ?? {};
	rejectRedundantOverride(
		model.contextWindowTokens,
		overrides.contextWindowTokens,
		`${deploymentId}.overrides.contextWindowTokens`
	);
	rejectRedundantOverride(
		model.maxOutputTokens,
		overrides.maxOutputTokens,
		`${deploymentId}.overrides.maxOutputTokens`
	);
	const contextWindowTokens = overrides.contextWindowTokens ?? model.contextWindowTokens;
	const maxOutputTokens = overrides.maxOutputTokens ?? model.maxOutputTokens;
	if (contextWindowTokens > model.contextWindowTokens) {
		throw new Error(`${deploymentId}: context limit may only narrow the model limit`);
	}
	if (maxOutputTokens > model.maxOutputTokens) {
		throw new Error(`${deploymentId}: output limit may only narrow the model limit`);
	}
	if (maxOutputTokens > contextWindowTokens) {
		throw new Error(`${deploymentId}: output limit must fit inside the context window`);
	}
	return { contextWindowTokens, maxOutputTokens };
}

function effectiveCapabilities(graph, deploymentId, model, deployment) {
	const routeCapabilities = oneRouteFact(graph, deploymentId, deployment, 'capabilities');
	const routeSupport = structuredClone(routeCapabilities);
	const modelCapabilities = new Map();
	const overrides = deployment.overrides ?? {};
	const deploymentCapabilities = overrides.capabilities ?? {};
	for (const [name, value] of Object.entries(model.capabilities)) {
		modelCapabilities.set(name, value);
		routeCapabilities[name] = Boolean(routeCapabilities[name] && value);
	}
	rejectRedundantOverride(
		routeCapabilities,
		deploymentCapabilities,
		`${deploymentId}.overrides.capabilities`
	);
	for (const [name, value] of Object.entries(deploymentCapabilities)) {
		if (value && !routeSupport[name]) {
			throw new Error(`${deploymentId}: cannot enable route-unsupported capability ${name}`);
		}
		if (value && modelCapabilities.get(name) === false) {
			throw new Error(`${deploymentId}: cannot enable model-unsupported capability ${name}`);
		}
		routeCapabilities[name] = value;
	}
	const inputModalities = overrides.inputModalities ?? model.inputModalities;
	const outputModalities = overrides.outputModalities ?? model.outputModalities;
	rejectRedundantOverride(
		model.inputModalities,
		overrides.inputModalities,
		`${deploymentId}.overrides.inputModalities`
	);
	rejectRedundantOverride(
		model.outputModalities,
		overrides.outputModalities,
		`${deploymentId}.overrides.outputModalities`
	);
	for (const [name, values, modelValues] of [
		['inputModalities', inputModalities, model.inputModalities],
		['outputModalities', outputModalities, model.outputModalities]
	]) {
		validateCanonicalList(values, canonicalModalityRanks, `${deploymentId}: ${name}`);
		for (const value of values) {
			if (!modelValues.includes(value)) {
				throw new Error(`${deploymentId}: cannot enable model-unsupported ${name} value ${value}`);
			}
		}
	}
	return { capabilities: routeCapabilities, inputModalities, outputModalities };
}

function effectiveReasoning(deploymentId, model, deployment) {
	const reasoningOverride = deployment.overrides?.reasoning;
	rejectRedundantOverride(
		model.reasoning,
		reasoningOverride,
		`${deploymentId}.overrides.reasoning`
	);
	const reasoning = reasoningOverride ?? model.reasoning;
	if (!reasoningValues.has(reasoning)) {
		throw new Error(`${deploymentId}: invalid reasoning value`);
	}
	if (model.reasoning === 'unsupported' && reasoning !== 'unsupported') {
		throw new Error(`${deploymentId}: cannot enable model-unsupported reasoning`);
	}
	if (model.reasoning === 'required' && reasoning !== 'required') {
		throw new Error(`${deploymentId}: cannot weaken required model reasoning`);
	}
	rejectRedundantOverride(
		model.reasoningEfforts,
		deployment.overrides?.reasoningEfforts,
		`${deploymentId}.overrides.reasoningEfforts`
	);
	const reasoningEfforts = [...(deployment.overrides?.reasoningEfforts ?? model.reasoningEfforts)];
	const modelEfforts = new Set(model.reasoningEfforts);
	let previousEffortRank = -1;
	for (const effort of reasoningEfforts) {
		const effortRank = canonicalEffortRanks.get(effort);
		if (effortRank === undefined) {
			throw new Error(`${deploymentId}: invalid reasoning effort ${effort}`);
		}
		if (effortRank <= previousEffortRank) {
			throw new Error(
				`${deploymentId}: reasoning efforts must use canonical order without repeats`
			);
		}
		previousEffortRank = effortRank;
		if (!modelEfforts.has(effort)) {
			throw new Error(`${deploymentId}: reasoning effort ${effort} is absent from the model`);
		}
	}
	const override = deployment.overrides?.reasoningMaxTokens;
	rejectRedundantOverride(
		model.reasoningMaxTokens,
		override,
		`${deploymentId}.overrides.reasoningMaxTokens`
	);
	if (override && !model.reasoningMaxTokens) {
		throw new Error(
			`${deploymentId}: cannot enable a model-unsupported manual reasoning token limit`
		);
	}
	if (override && model.reasoningMaxTokens && override.minimum < model.reasoningMaxTokens.minimum) {
		throw new Error(`${deploymentId}: cannot lower the model manual reasoning token minimum`);
	}
	if (override && model.reasoningMaxTokens && override.maximum > model.reasoningMaxTokens.maximum) {
		throw new Error(`${deploymentId}: cannot raise the model manual reasoning token maximum`);
	}
	const reasoningMaxTokens = override === undefined ? model.reasoningMaxTokens : override;
	if (reasoning === 'unsupported' && (reasoningEfforts.length > 0 || reasoningMaxTokens !== null)) {
		throw new Error(`${deploymentId}: unsupported reasoning cannot expose controls`);
	}
	return {
		reasoning,
		reasoningEfforts,
		reasoningMaxTokens
	};
}

function effectiveRouteOverrides(deploymentId, deployment, reasoningEfforts) {
	const sourceOverrides = deployment.overrides?.routes ?? {};
	const routeOverrides = {};
	const deploymentEfforts = new Set(reasoningEfforts);
	for (const [routeId, override] of Object.entries(sourceOverrides)) {
		if (!deployment.routeIds.includes(routeId)) {
			throw new Error(`${deploymentId}.overrides.routes references unattached route ${routeId}`);
		}
		rejectRedundantOverride(
			reasoningEfforts,
			override.reasoningEfforts,
			`${deploymentId}.overrides.routes.${routeId}.reasoningEfforts`
		);
		let previousEffortRank = -1;
		for (const effort of override.reasoningEfforts) {
			const effortRank = canonicalEffortRanks.get(effort);
			if (effortRank === undefined) {
				throw new Error(`${deploymentId}: invalid ${routeId} reasoning effort ${effort}`);
			}
			if (effortRank <= previousEffortRank) {
				throw new Error(
					`${deploymentId}: ${routeId} reasoning efforts must use canonical order without repeats`
				);
			}
			previousEffortRank = effortRank;
			if (!deploymentEfforts.has(effort)) {
				throw new Error(
					`${deploymentId}: ${routeId} reasoning effort ${effort} is absent from the deployment`
				);
			}
		}
		routeOverrides[routeId] = {
			reasoningEfforts: [...override.reasoningEfforts]
		};
	}
	return routeOverrides;
}

function effectiveDataHandlingByRoute(graph, deploymentId, deployment) {
	return Object.fromEntries(
		[...deployment.routeIds].sort().map((routeId) => {
			const routeValue = requireNode(graph.routes, routeId, deploymentId).dataHandling;
			rejectRedundantOverride(
				routeValue,
				deployment.overrides?.dataHandling,
				`${deploymentId}.overrides.dataHandling`
			);
			const value = mergeFacts(routeValue, deployment.overrides?.dataHandling ?? {});
			validateDataHandling(`${deploymentId}.overrides.dataHandling`, value);
			return [
				routeId,
				{
					processingLocation: value.processingLocation,
					storageLocation: value.storageLocation,
					endToEndEncrypted: value.endToEndEncrypted,
					retentionDays: value.retentionDays,
					trainingUse: value.trainingUse,
					zeroDataRetention: value.zeroDataRetention,
					tee: value.tee,
					teeVerified: value.teeVerified
				}
			];
		})
	);
}

function effectiveDeprecationDate(deploymentId, model, deployment) {
	if (deployment.overrides && 'deprecationDate' in deployment.overrides) {
		rejectRedundantOverride(
			model.deprecationDate,
			deployment.overrides.deprecationDate,
			`${deploymentId}.overrides.deprecationDate`
		);
		return deployment.overrides.deprecationDate;
	}
	return model.deprecationDate;
}

export function buildCatalogs(source) {
	const sourceGraph = normalizeSourceGraph(source.graph);
	const graph = {
		...sourceGraph,
		routes: Object.fromEntries(
			Object.entries(sourceGraph.routes).map(([routeId, route]) => {
				const provider = requireNode(sourceGraph.providers, route.providerId, routeId);
				validateCanonicalList(route.interfaces, canonicalInterfaceRanks, `${routeId}: interfaces`);
				validateRouteEndpoint(routeId, route.endpoint);
				const overrides = route.overrides ?? {};
				rejectRedundantOverride(
					provider.capabilities,
					overrides.capabilities,
					`${routeId}.overrides.capabilities`
				);
				const capabilities = mergeFacts(provider.capabilities, overrides.capabilities ?? {});
				const capabilityNames = [
					'streaming',
					'cancellation',
					'functionCalling',
					'parallelFunctionCalling',
					'implicitPromptCaching',
					'explicitPromptCaching',
					'structuredOutputs',
					'systemMessages',
					'toolChoice',
					'urlContext',
					'pdfInput'
				];
				for (const capability of capabilityNames) {
					if (typeof capabilities[capability] !== 'boolean') capabilities[capability] = false;
				}
				const dataHandling = mergeFacts(provider.dataHandling, route.dataHandling);
				for (const field of [
					'processingLocation',
					'storageLocation',
					'endToEndEncrypted',
					'retentionDays',
					'trainingUse',
					'zeroDataRetention',
					'tee',
					'teeVerified'
				]) {
					if (!(field in dataHandling)) {
						throw new Error(`${routeId}: dataHandling.${field} is unresolved`);
					}
				}
				validateDataHandling(routeId, dataHandling);
				const pricing = mergeFacts(provider.pricing ?? {}, route.pricing ?? {});
				return [
					routeId,
					{
						providerId: route.providerId,
						endpoint: route.endpoint,
						interfaces: [...route.interfaces],
						capabilities,
						dataHandling,
						pricing
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
		for (const field of ['releaseDate', 'snapshot', 'knowledgeCutoff']) {
			if (model[field] !== null && !validDate(model[field])) {
				throw new Error(`${modelId}: ${field} is invalid`);
			}
		}
		if (!validDeprecationDate(model.deprecationDate)) {
			throw new Error(`${modelId}: deprecationDate is invalid`);
		}
		if (
			model.releaseDate !== null &&
			model.deprecationDate !== null &&
			model.deprecationDate < model.releaseDate
		) {
			throw new Error(`${modelId}: deprecationDate precedes releaseDate`);
		}
		if (!reasoningValues.has(model.reasoning)) {
			throw new Error(`${modelId}: invalid reasoning value`);
		}
		let previousEffortRank = -1;
		for (const effort of model.reasoningEfforts) {
			const effortRank = canonicalEffortRanks.get(effort);
			if (effortRank === undefined)
				throw new Error(`${modelId}: invalid reasoning effort ${effort}`);
			if (effortRank <= previousEffortRank) {
				throw new Error(`${modelId}: reasoning efforts must use canonical order without repeats`);
			}
			previousEffortRank = effortRank;
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
		for (const alias of model.aliases) addSelector(alias, 'model', modelId);
	}
	validateModelDerivation(graph.models);

	for (const [deploymentId, sourceDeployment] of Object.entries(graph.deployments)) {
		const deployment = structuredClone(sourceDeployment);
		validateAliasCount(deployment.aliases ?? [], 'deployment', deploymentId);
		if (new Set(deployment.routeIds).size !== deployment.routeIds.length) {
			throw new Error(`${deploymentId}: routeIds must not repeat`);
		}
		const model = requireNode(graph.models, deployment.modelId, deploymentId);
		const providerId = providerForDeployment(graph, deploymentId, deployment);
		if (!deployment.upstream?.model) {
			throw new Error(`${deploymentId}: upstream model is required`);
		}
		const deprecationDate = effectiveDeprecationDate(deploymentId, model, deployment);
		if (!validDeprecationDate(deprecationDate)) {
			throw new Error(`${deploymentId}: deprecationDate is invalid`);
		}
		if (
			deprecationDate !== null &&
			model.releaseDate !== null &&
			deprecationDate < model.releaseDate
		) {
			throw new Error(`${deploymentId}: deprecationDate precedes model releaseDate`);
		}
		const selectorKeys = Object.keys(deployment.upstream).sort();
		const selectorKeysValid =
			(providerId === 'openai' &&
				selectorKeys.includes('model') &&
				selectorKeys.includes('serviceTier') &&
				selectorKeys.every((key) => ['model', 'reasoningMode', 'serviceTier'].includes(key))) ||
			(providerId === 'anthropic' &&
				selectorKeys.includes('model') &&
				selectorKeys.every((key) => ['inferenceGeo', 'model', 'speed'].includes(key))) ||
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
		if (providerId === 'azure') {
			const usesAnthropicMessages = deployment.routeIds.includes('azure-anthropic-messages');
			const modelFormat = deployment.upstream.modelFormat.toLowerCase();
			const isAnthropicModel = model.authorId === 'anthropic';
			if (
				isAnthropicModel
					? modelFormat !== 'anthropic' ||
						deployment.routeIds.length !== 1 ||
						!usesAnthropicMessages
					: modelFormat === 'anthropic' || usesAnthropicMessages
			) {
				throw new Error(
					`${deploymentId}: Azure Anthropic models and format must use only the Azure Anthropic Messages route`
				);
			}
			if (
				(modelFormat === 'anthropic' &&
					!['anthropic', 'azure'].includes(deployment.upstream.hosting)) ||
				(modelFormat === 'fireworks' && deployment.upstream.hosting !== 'fireworks') ||
				(['deepseek', 'openai', 'openai-oss'].includes(modelFormat) &&
					deployment.upstream.hosting !== 'azure') ||
				(modelFormat === 'nvidia' && deployment.upstream.hosting !== 'nvidia')
			) {
				throw new Error(`${deploymentId}: Azure model format and hosting do not match`);
			}
			if (
				model.authorId === 'anthropic' &&
				!['anthropic', 'azure'].includes(deployment.upstream.hosting)
			) {
				throw new Error(`${deploymentId}: Azure Claude hosting must be azure or anthropic`);
			}
			if (
				deployment.upstream.hosting === 'anthropic' &&
				deployment.upstream.deploymentType !== 'global_standard'
			) {
				throw new Error(`${deploymentId}: Anthropic-hosted Azure Claude is Global Standard only`);
			}
			if (
				deployment.upstream.deploymentType !== 'global_standard' &&
				!['azure', 'fireworks'].includes(deployment.upstream.hosting)
			) {
				throw new Error(
					`${deploymentId}: this Azure hosting mode does not offer Data Zone Standard`
				);
			}
			if (
				deployment.upstream.serviceTier === 'priority' &&
				(deployment.upstream.hosting !== 'azure' ||
					modelFormat !== 'openai' ||
					deployment.upstream.deploymentType !== 'global_standard')
			) {
				throw new Error(`${deploymentId}: Azure Priority is unavailable for this target`);
			}
			if (
				deployment.upstream.deploymentType === 'instant' &&
				(deployment.upstream.hosting !== 'azure' ||
					modelFormat !== 'openai' ||
					deployment.upstream.serviceTier !== 'default')
			) {
				throw new Error(
					`${deploymentId}: Azure Instant requires a default-tier Azure OpenAI target`
				);
			}
			if (
				modelFormat === 'fireworks' &&
				(deployment.upstream.deploymentType !== 'data_zone_standard_us' ||
					deployment.routeIds.length !== 1 ||
					deployment.routeIds[0] !== 'azure-chat-completions')
			) {
				throw new Error(
					`${deploymentId}: Fireworks pay-per-token requires US Data Zone Chat Completions`
				);
			}
		}
		if (
			deployment.upstream.reasoningMode &&
			(!['openai', 'azure'].includes(providerId) ||
				model.authorId !== 'openai' ||
				deployment.routeIds.some((routeId) => {
					const interfaces = requireNode(graph.routes, routeId, deploymentId).interfaces;
					return interfaces.length !== 1 || interfaces[0] !== 'responses';
				}))
		) {
			throw new Error(`${deploymentId}: fixed reasoning mode requires an OpenAI Responses model`);
		}
		const { contextWindowTokens, maxOutputTokens } = effectiveTokenLimits(
			deploymentId,
			model,
			deployment
		);
		const { capabilities, inputModalities, outputModalities } = effectiveCapabilities(
			graph,
			deploymentId,
			model,
			deployment
		);
		const { reasoning, reasoningEfforts, reasoningMaxTokens } = effectiveReasoning(
			deploymentId,
			model,
			deployment
		);
		const routeOverrides = effectiveRouteOverrides(deploymentId, deployment, reasoningEfforts);
		if (
			reasoningMaxTokens &&
			((providerId !== 'anthropic' &&
				!(providerId === 'azure' && model.authorId === 'anthropic')) ||
				reasoningMaxTokens.minimum > reasoningMaxTokens.maximum ||
				reasoningMaxTokens.maximum >= maxOutputTokens)
		) {
			throw new Error(`${deploymentId}: invalid manual reasoning token limit`);
		}
		const pricing = mergePricing(graph, deploymentId, deployment);
		const dataHandlingByRoute = effectiveDataHandlingByRoute(graph, deploymentId, deployment);
		const dataHandlingValues = Object.values(dataHandlingByRoute);
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
		if (
			providerId === 'azure' &&
			deployment.upstream.hosting !== 'azure' &&
			dataHandlingValues.some(
				(value) =>
					value.processingLocation !== 'unknown' ||
					!['none', 'unknown'].includes(value.storageLocation)
			)
		) {
			throw new Error(
				`${deploymentId}: externally hosted Azure locations must remain unknown or none`
			);
		}
		const baseStates = deployment.routeIds.map(
			(routeId) => baseByModelRoute.get(`${deployment.modelId}\0${routeId}`) === deploymentId
		);
		if (new Set(baseStates).size !== 1) {
			throw new Error(`${deploymentId}: split deployments whose routes have different bases`);
		}

		addSelector(deploymentId, 'deployment', deploymentId);
		for (const alias of deployment.aliases ?? []) {
			if (alias === deployment.modelId) {
				throw new Error(`${deploymentId}: deployment alias duplicates model slug ${alias}`);
			}
			addSelector(alias, 'deployment', deploymentId);
		}

		const common = {
			aliases: [...(deployment.aliases ?? [])],
			capabilities,
			contextWindowTokens,
			deprecationDate,
			inputModalities: [...inputModalities],
			maxOutputTokens,
			modelId: deployment.modelId,
			outputModalities: [...outputModalities],
			pricing,
			reasoning,
			reasoningEfforts,
			reasoningMaxTokens,
			...(Object.keys(routeOverrides).length > 0 ? { routeOverrides } : {}),
			routeIds: [...deployment.routeIds].sort(),
			upstream: deployment.upstream,
			dataHandlingByRoute,
			...(deployment.weightPrecision ? { weightPrecision: deployment.weightPrecision } : {})
		};
		publicDeployments[deploymentId] = {
			aliases: [...(deployment.aliases ?? [])],
			modelId: deployment.modelId,
			pricing: structuredClone(deployment.pricing),
			routeIds: [...deployment.routeIds].sort(),
			upstream: structuredClone(deployment.upstream),
			...(deployment.overrides ? { overrides: structuredClone(deployment.overrides) } : {}),
			...(deployment.weightPrecision ? { weightPrecision: deployment.weightPrecision } : {})
		};
		runtimeDeployments[deploymentId] = common;

		requireNode(graph.providers, providerId, deploymentId);
	}

	const runtimeRoutes = Object.fromEntries(
		Object.entries(graph.routes).map(([id, route]) => [
			id,
			{
				providerId: route.providerId,
				interfaces: route.interfaces
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
			{ aliases: author.aliases, name: author.name }
		])
	);
	const runtimeProviders = Object.fromEntries(
		Object.entries(graph.providers).map(([id, provider]) => [
			id,
			{
				aliases: provider.aliases,
				credentialModes: provider.credentialModes,
				name: provider.name
			}
		])
	);

	return {
		runtime: {
			schema: 'stogas.catalog.runtime.v3',
			graph: {
				authors: runtimeAuthors,
				models: runtimeModels,
				providers: runtimeProviders,
				routes: runtimeRoutes,
				deployments: runtimeDeployments
			}
		},
		public: {
			schema: 'stogas.catalog.public.v3',
			graph: {
				authors: graph.authors,
				models: graph.models,
				providers: sourceGraph.providers,
				routes: sourceGraph.routes,
				deployments: publicDeployments
			}
		}
	};
}

function writeIfChanged(path, content) {
	if (existsSync(path) && readFileSync(path, 'utf8') === content) return;
	writeFileSync(path, content);
}

function assertSize(name, content, limit) {
	const size = Buffer.byteLength(content);
	if (size > limit) throw new Error(`${name} is ${size} bytes; limit is ${limit}`);
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
			throw new Error('generated must be a regular directory');
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
		const generatedFileOwnedSource = writeFileOwnedNodeSource(fileOwnedSources);
		const cue = await resolveCueCommand();
		const sourceFiles = [
			...cueFiles,
			...dataFiles,
			...(generatedFileOwnedSource ? [rel(generatedFileOwnedSource)] : [])
		];
		const exported = await run([
			...cue,
			'export',
			...sourceFiles,
			'-e',
			'compiledSource',
			'--out',
			'json'
		]);
		const catalogs = buildCatalogs(JSON.parse(exported));
		const publicJson = stableJson(catalogs.public);
		catalogs.runtime.publicDigest = `sha256:${createHash('sha256').update(publicJson).digest('hex')}`;
		const runtimeJson = stableJson(catalogs.runtime);
		assertSize('runtime catalog', runtimeJson, runtimeSizeLimit);
		assertSize('public catalog', publicJson, publicSizeLimit);

		if (!args.has('--validate-only')) {
			if (args.has('--check')) {
				const currentRuntime = existsSync(runtimePath) ? readFileSync(runtimePath, 'utf8') : null;
				const currentPublic = existsSync(publicPath) ? readFileSync(publicPath, 'utf8') : null;
				if (currentRuntime !== runtimeJson || currentPublic !== publicJson) {
					throw new Error('Generated catalog artifacts are stale. Run `bun run build`.');
				}
			} else {
				mkdirSync(generatedRoot, { recursive: true });
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
