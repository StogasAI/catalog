import { spawn } from 'node:child_process';
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	rmdirSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const repositoryRoot = join(sourceRoot, '..');
const generatedRoot = join(repositoryRoot, 'generated');
const runtimePath = join(generatedRoot, 'catalog.runtime.json');
const publicPath = join(generatedRoot, 'catalog.public.json');
const tempBuildRoot = join(sourceRoot, '.tmp-catalog-build');
const cueVersion = 'v0.16.1';
const toolCacheDir = join(resolveToolCacheRoot(), 'cue', cueVersion);
const cachedCue = join(toolCacheDir, process.platform === 'win32' ? 'cue.exe' : 'cue');
const args = new Set(process.argv.slice(2));
const canonicalEfforts = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const runtimeSizeLimit = 16 * 1024 * 1024;
const publicSizeLimit = 64 * 1024 * 1024;
let tempBuildDir = null;

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
		const stats = statSync(path);
		if (stats.isDirectory()) files.push(...walkFiles(path, predicate));
		else if (predicate(path)) files.push(path);
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
		grouped.set(source.type, [...(grouped.get(source.type) ?? []), source]);
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
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk) => (stdout += chunk));
		child.stderr.on('data', (chunk) => (stderr += chunk));
		child.on('error', reject);
		child.on('close', (code) => {
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

async function resolveCueCommand() {
	const configured = process.env.CUE_BIN?.trim();
	if (configured) return configured.split(/\s+/);
	if (existsSync(cachedCue) && (await commandWorks([cachedCue, 'version']))) return [cachedCue];
	if (await commandWorks(['cue', 'version'])) return ['cue'];
	if (await commandWorks(['go', 'version'])) {
		mkdirSync(toolCacheDir, { recursive: true });
		await run(['go', 'install', `cuelang.org/go/cmd/cue@${cueVersion}`], {
			env: { GOBIN: toolCacheDir }
		});
		return [cachedCue];
	}
	throw new Error('CUE is required. Install CUE or Go, or set CUE_BIN.');
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

function stableJson(value) {
	return `${JSON.stringify(stableValue(value))}\n`;
}

function same(left, right) {
	return stableJson(left) === stableJson(right);
}

function validDeprecationDate(value) {
	if (value === null) return true;
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
					reasoningEfforts: [...(model.reasoningEfforts ?? [])],
					releaseDate: model.releaseDate ?? null,
					snapshot: model.snapshot ?? null
				}
			])
		),
		providers: Object.fromEntries(
			Object.entries(sourceGraph.providers).map(([id, provider]) => [
				id,
				{ ...provider, aliases: [...(provider.aliases ?? [])] }
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
	for (const meter of Object.keys(deployment.pricing)) {
		if (pricing[meter]) {
			throw new Error(`${deploymentId}.pricing.${meter} is already owned by one of its routes`);
		}
	}
	return mergeFacts(pricing, deployment.pricing);
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
		if (value && !routeCapabilities[name]) {
			throw new Error(`${deploymentId}: model requires route-unsupported capability ${name}`);
		}
		modelCapabilities.set(name, value);
		routeCapabilities[name] = value;
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
		if (!Array.isArray(values) || values.length === 0) {
			throw new Error(`${deploymentId}: ${name} must not be empty`);
		}
		for (const value of values) {
			if (!modelValues.includes(value)) {
				throw new Error(`${deploymentId}: cannot enable model-unsupported ${name} value ${value}`);
			}
		}
	}
	return { capabilities: routeCapabilities, inputModalities, outputModalities };
}

function effectiveReasoning(deploymentId, model, deployment) {
	rejectRedundantOverride(
		model.reasoningEfforts,
		deployment.overrides?.reasoningEfforts,
		`${deploymentId}.overrides.reasoningEfforts`
	);
	const reasoningEfforts = [...(deployment.overrides?.reasoningEfforts ?? model.reasoningEfforts)];
	const modelEfforts = new Set(model.reasoningEfforts);
	for (const effort of reasoningEfforts) {
		if (!canonicalEfforts.has(effort)) {
			throw new Error(`${deploymentId}: invalid reasoning effort ${effort}`);
		}
		if (!modelEfforts.has(effort)) {
			throw new Error(`${deploymentId}: reasoning effort ${effort} is absent from the model`);
		}
	}
	return reasoningEfforts;
}

function effectiveDataHandling(graph, deploymentId, deployment) {
	const routeValue = oneRouteFact(graph, deploymentId, deployment, 'dataHandling');
	rejectRedundantOverride(
		routeValue,
		deployment.overrides?.dataHandling,
		`${deploymentId}.overrides.dataHandling`
	);
	const value = mergeFacts(routeValue, deployment.overrides?.dataHandling ?? {});
	return {
		processingRegions: [...value.processingRegions],
		storageRegions: [...value.storageRegions],
		retentionDays: value.retentionDays,
		trainingUse: value.trainingUse,
		zeroDataRetention: value.zeroDataRetention
	};
}

function effectiveModerated(graph, deploymentId, deployment) {
	const routeValue = oneRouteFact(graph, deploymentId, deployment, 'moderated');
	rejectRedundantOverride(
		routeValue,
		deployment.overrides?.moderated,
		`${deploymentId}.overrides.moderated`
	);
	return deployment.overrides?.moderated ?? routeValue;
}

function effectiveTee(graph, deploymentId, deployment) {
	const routeValue = oneRouteFact(graph, deploymentId, deployment, 'tee');
	if (!routeValue && deployment.overrides?.tee) {
		throw new Error(`${deploymentId}: cannot override an absent route TEE policy`);
	}
	rejectRedundantOverride(routeValue, deployment.overrides?.tee, `${deploymentId}.overrides.tee`);
	return routeValue ? mergeFacts(routeValue, deployment.overrides?.tee ?? {}) : undefined;
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

function buildCatalogs(source) {
	const sourceGraph = normalizeSourceGraph(source.graph);
	const graph = {
		...sourceGraph,
		routes: Object.fromEntries(
			Object.entries(sourceGraph.routes).map(([routeId, route]) => {
				const provider = requireNode(sourceGraph.providers, route.providerId, routeId);
				const overrides = route.overrides ?? {};
				rejectRedundantOverride(
					provider.capabilities,
					overrides.capabilities,
					`${routeId}.overrides.capabilities`
				);
				rejectRedundantOverride(
					provider.dataHandling,
					overrides.dataHandling,
					`${routeId}.overrides.dataHandling`
				);
				rejectRedundantOverride(
					provider.moderated,
					overrides.moderated,
					`${routeId}.overrides.moderated`
				);
				const capabilities = mergeFacts(provider.capabilities, overrides.capabilities ?? {});
				const capabilityNames = [
					'streaming',
					'cancellation',
					'functionCalling',
					'parallelFunctionCalling',
					'promptCaching',
					'structuredOutputs',
					'systemMessages',
					'toolChoice',
					'webSearch',
					'urlContext',
					'pdfInput'
				];
				for (const capability of capabilityNames) {
					if (typeof capabilities[capability] !== 'boolean') capabilities[capability] = false;
				}
				const dataHandling = mergeFacts(provider.dataHandling, overrides.dataHandling ?? {});
				for (const field of [
					'processingRegions',
					'storageRegions',
					'retentionDays',
					'trainingUse',
					'zeroDataRetention'
				]) {
					if (!(field in dataHandling)) {
						throw new Error(`${routeId}: dataHandling.${field} is unresolved`);
					}
				}
				const moderated = overrides.moderated ?? provider.moderated;
				if (typeof moderated !== 'boolean') {
					throw new Error(`${routeId}: moderated is unresolved`);
				}
				return [
					routeId,
					{
						providerId: route.providerId,
						endpoint: route.endpoint,
						interfaces: [...route.interfaces],
						capabilities,
						dataHandling,
						moderated,
						pricing: structuredClone(route.pricing ?? {}),
						...(route.tee ? { tee: route.tee } : {})
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
			deploymentsByModelRoute.set(key, [...(deploymentsByModelRoute.get(key) ?? []), deploymentId]);
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

	for (const [modelId, model] of Object.entries(graph.models)) {
		addSelector(modelId, 'model', modelId);
		for (const alias of model.aliases) addSelector(alias, 'model', modelId);
	}

	for (const [deploymentId, sourceDeployment] of Object.entries(graph.deployments)) {
		const deployment = structuredClone(sourceDeployment);
		const model = requireNode(graph.models, deployment.modelId, deploymentId);
		const providerId = providerForDeployment(graph, deploymentId, deployment);
		if (!deployment.upstream?.model) {
			throw new Error(`${deploymentId}: upstream model is required`);
		}
		const deprecationDate = effectiveDeprecationDate(deploymentId, model, deployment);
		if (!validDeprecationDate(deprecationDate)) {
			throw new Error(`${deploymentId}: deprecationDate is invalid`);
		}
		const selectorKeys = Object.keys(deployment.upstream).sort();
		const selectorKeysValid =
			(providerId === 'openai' &&
				JSON.stringify(selectorKeys) === JSON.stringify(['model', 'serviceTier'])) ||
			(providerId === 'anthropic' &&
				selectorKeys.includes('model') &&
				selectorKeys.includes('serviceTier') &&
				selectorKeys.every((key) =>
					['inferenceGeo', 'model', 'serviceTier', 'speed'].includes(key)
				)) ||
			(providerId === 'chutes' &&
				Boolean(deployment.upstream.chuteId) &&
				JSON.stringify(selectorKeys) === JSON.stringify(['chuteId', 'model']) &&
				Boolean(deployment.release));
		if (!selectorKeysValid) {
			throw new Error(`${deploymentId}: upstream selector does not match provider ${providerId}`);
		}
		if (providerId !== 'chutes' && deployment.release) {
			throw new Error(`${deploymentId}: release metadata is only defined for Chutes`);
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
		const reasoningEfforts = effectiveReasoning(deploymentId, model, deployment);
		const pricing = mergePricing(graph, deploymentId, deployment);
		const dataHandling = effectiveDataHandling(graph, deploymentId, deployment);
		const moderated = effectiveModerated(graph, deploymentId, deployment);
		const tee = effectiveTee(graph, deploymentId, deployment);
		const baseStates = deployment.routeIds.map(
			(routeId) => baseByModelRoute.get(`${deployment.modelId}\0${routeId}`) === deploymentId
		);
		if (new Set(baseStates).size !== 1) {
			throw new Error(`${deploymentId}: split deployments whose routes have different bases`);
		}

		addSelector(deploymentId, 'deployment', deploymentId);
		for (const alias of deployment.aliases ?? []) {
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
			reasoningEfforts,
			routeIds: [...deployment.routeIds].sort(),
			upstream: deployment.upstream,
			...(tee ? { tee } : {}),
			...(deployment.weightPrecision ? { weightPrecision: deployment.weightPrecision } : {})
		};
		publicDeployments[deploymentId] = {
			...common,
			dataHandling,
			moderated,
			...(deployment.release ? { release: deployment.release } : {})
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
					name: model.name,
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
			{ aliases: provider.aliases, name: provider.name }
		])
	);

	return {
		runtime: {
			schema: 'stogas.catalog.runtime.v1',
			graph: {
				authors: runtimeAuthors,
				models: runtimeModels,
				providers: runtimeProviders,
				routes: runtimeRoutes,
				deployments: runtimeDeployments
			}
		},
		public: {
			schema: 'stogas.catalog.public.v1',
			graph: {
				authors: graph.authors,
				models: graph.models,
				providers: graph.providers,
				routes: graph.routes,
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

if (args.has('--clean')) {
	rmSync(generatedRoot, { force: true, recursive: true });
	rmSync(tempBuildRoot, { force: true, recursive: true });
	process.exit(0);
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
const generatedFileOwnedSource = writeFileOwnedNodeSource(fileOwnedSources);

try {
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
	const runtimeJson = stableJson(catalogs.runtime);
	const publicJson = stableJson(catalogs.public);
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
