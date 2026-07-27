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
	for (const [meter, rates] of Object.entries(deployment.pricing)) {
		if (pricing[meter]) {
			throw new Error(`${deploymentId}: deployment pricing shadows route meter ${meter}`);
		}
		pricing[meter] = structuredClone(rates);
	}
	return pricing;
}

function effectiveLimits(deploymentId, model, deployment) {
	const limits = { ...model.limits, ...(deployment.limits ?? {}) };
	if (limits.contextTokens > model.limits.contextTokens) {
		throw new Error(`${deploymentId}: context limit may only narrow the model limit`);
	}
	if (limits.outputTokens > model.limits.outputTokens) {
		throw new Error(`${deploymentId}: output limit may only narrow the model limit`);
	}
	return limits;
}

function effectiveCapabilities(graph, deploymentId, model, deployment) {
	const routeCapabilities = oneRouteFact(graph, deploymentId, deployment, 'capabilities');
	for (const [name, value] of Object.entries(deployment.capabilities ?? {})) {
		if (value && !routeCapabilities[name]) {
			throw new Error(`${deploymentId}: cannot enable route-unsupported capability ${name}`);
		}
		routeCapabilities[name] = value;
	}
	return {
		inputModalities: [...model.capabilities.inputModalities],
		outputModalities: [...model.capabilities.outputModalities],
		...routeCapabilities
	};
}

function effectiveReasoning(deploymentId, model, deployment) {
	const reasoningEfforts = [...(deployment.reasoningEfforts ?? model.reasoningEfforts)];
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
	const override = deployment.dataHandling ?? {};
	return {
		processingRegions: [...(override.processingRegions ?? routeValue.processingRegions)],
		storageRegions: [...(override.storageRegions ?? routeValue.storageRegions)],
		retentionDays: override.retentionDays ?? routeValue.retentionDays,
		trainingUse: override.trainingUse ?? routeValue.trainingUse,
		zeroDataRetention: override.zeroDataRetention ?? routeValue.zeroDataRetention
	};
}

function effectiveModeration(graph, deploymentId, deployment) {
	const routeValue = oneRouteFact(graph, deploymentId, deployment, 'moderation');
	const override = deployment.moderation ?? {};
	return {
		input: override.input ?? routeValue.input,
		output: override.output ?? routeValue.output
	};
}

function buildCatalogs(source) {
	const graph = source.graph;
	const aliases = new Set();
	const runtimeDeployments = {};
	const publicDeployments = {};
	const providerSlugOwners = new Map();

	for (const [providerId, provider] of Object.entries(graph.providers)) {
		for (const slug of provider.slugs) {
			const owner = providerSlugOwners.get(slug);
			if (owner) throw new Error(`provider slug ${slug} is shared by ${owner} and ${providerId}`);
			providerSlugOwners.set(slug, providerId);
		}
	}

	for (const [deploymentId, sourceDeployment] of Object.entries(graph.deployments)) {
		const deployment = structuredClone(sourceDeployment);
		const model = requireNode(graph.models, deployment.modelId, deploymentId);
		const providerId = providerForDeployment(graph, deploymentId, deployment);
		if (!deployment.upstream?.model || !deployment.upstream?.fixedRequest) {
			throw new Error(`${deploymentId}: upstream model and fixedRequest are required`);
		}
		const selectorKeys = Object.keys(deployment.upstream.fixedRequest).sort();
		const expectedKeys =
			providerId === 'openai'
				? ['service_tier']
				: providerId === 'anthropic'
					? ['inference_geo', 'service_tier', 'speed']
					: null;
		if (!expectedKeys || JSON.stringify(selectorKeys) !== JSON.stringify(expectedKeys)) {
			throw new Error(`${deploymentId}: upstream selector does not match provider ${providerId}`);
		}
		const limits = effectiveLimits(deploymentId, model, deployment);
		const capabilities = effectiveCapabilities(graph, deploymentId, model, deployment);
		const reasoningEfforts = effectiveReasoning(deploymentId, model, deployment);
		const pricing = mergePricing(graph, deploymentId, deployment);
		const dataHandling = effectiveDataHandling(graph, deploymentId, deployment);
		const moderation = effectiveModeration(graph, deploymentId, deployment);

		for (const alias of deployment.aliases) {
			if (alias.trim() !== alias || alias.includes('/')) {
				throw new Error(`${deploymentId}: alias ${alias} is not canonical`);
			}
			if (aliases.has(alias)) throw new Error(`${deploymentId}: alias ${alias} is duplicated`);
			aliases.add(alias);
		}

		const common = {
			aliases: [...deployment.aliases],
			modelId: deployment.modelId,
			routeIds: [...deployment.routeIds].sort(),
			upstream: deployment.upstream,
			limits,
			capabilities,
			reasoningEfforts,
			pricing,
			status: deployment.status,
			...(deployment.deprecatedAt ? { deprecatedAt: deployment.deprecatedAt } : {}),
			...(deployment.retiredAt ? { retiredAt: deployment.retiredAt } : {}),
			...(deployment.tee ? { tee: deployment.tee } : {})
		};
		runtimeDeployments[deploymentId] = common;
		publicDeployments[deploymentId] = {
			...common,
			dataHandling,
			moderation
		};

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
	const runtimeModels = Object.fromEntries(
		Object.entries(graph.models).map(([id, model]) => [
			id,
			{
				authorId: model.authorId,
				name: model.name,
				releaseDate: model.releaseDate
			}
		])
	);
	const runtimeAuthors = Object.fromEntries(
		Object.entries(graph.authors).map(([id, author]) => [
			id,
			{ name: author.name, slugs: author.slugs }
		])
	);
	const runtimeProviders = Object.fromEntries(
		Object.entries(graph.providers).map(([id, provider]) => [
			id,
			{ name: provider.name, slugs: provider.slugs }
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
