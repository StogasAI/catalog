import { createHash } from 'node:crypto';
import { canonicalJsonValue } from './canonical-json.mjs';
import { catalogAt } from './schedule.mjs';

// Use the compiler's resolved execution facts, together with the public node
// details. No release number enters the hash: unchanged paths keep their identity.
export function* resolvedCatalogChains(publicCatalog, runtimeCatalog) {
	const graph = publicCatalog.graph;
	for (const deploymentId of Object.keys(runtimeCatalog.graph.deployments).sort()) {
		const compiled = runtimeCatalog.graph.deployments[deploymentId];
		const source = requireNode(graph.deployments, deploymentId);
		const modelId = compiled.modelId;
		const model = requireNode(graph.models, modelId);
		const { groupIds: _navigationGroups, ...modelData } = model;
		const author = requireNode(graph.authors, model.authorId);
		for (const routeId of [...compiled.routeIds].sort()) {
			const route = requireNode(graph.routes, routeId);
			const provider = requireNode(graph.providers, route.providerId);
			const { overrides: _sourceOverrides, ...sourceData } = source;
			const {
				chainHashes: _chainHashes,
				dataHandlingByRoute,
				nativeFileInputsByRoute,
				routeOverrides,
				...executionData
			} = compiled;
			const { overrides: routeSourceOverrides, ...routeData } = route;
			const chain = {
				author: { id: model.authorId, data: author },
				model: { id: modelId, data: modelData },
				deployment: {
					id: deploymentId,
					data: {
						...sourceData,
						...executionData,
						...routeOverrides?.[routeId],
						routeIds: [routeId],
						dataHandling: requireNode(dataHandlingByRoute, routeId),
						nativeFileInputs: requireNode(nativeFileInputsByRoute, routeId)
					}
				},
				route: {
					id: routeId,
					data: {
						...routeData,
						capabilities: { ...provider.capabilities, ...routeSourceOverrides?.capabilities },
						dataHandling: { ...provider.dataHandling, ...route.dataHandling },
						pricing: route.pricing ?? {}
					}
				},
				provider: { id: route.providerId, data: provider }
			};
			const json = canonicalJsonValue(chain);
			yield {
				deploymentId,
				routeId,
				hash: `sha256:${createHash('sha256').update(json).digest('hex')}`,
				json
			};
		}
	}
}

// A request logs the chain in effect when it ran, so request history needs the chains of
// the base graph and of every dated state. Each chain is yielded once.
export function* everyStateCatalogChains(publicCatalog, runtimeCatalog) {
	const instants = new Set(
		[...publicCatalog.schedule, ...runtimeCatalog.schedule].map(({ start }) => Date.parse(start))
	);
	const seen = new Set();
	for (const at of [-Infinity, ...[...instants].sort((left, right) => left - right)]) {
		const runtime = catalogAt(runtimeCatalog, at);
		for (const entry of resolvedCatalogChains(
			{ graph: catalogAt(publicCatalog, at) },
			{ graph: runtime }
		)) {
			if (runtime.deployments[entry.deploymentId].chainHashes?.[entry.routeId] !== entry.hash) {
				throw new Error('Compiled catalog chain differs from its history.');
			}
			if (seen.has(entry.hash)) continue;
			seen.add(entry.hash);
			yield entry;
		}
	}
}

function requireNode(nodes, id) {
	const value = nodes && Object.hasOwn(nodes, id) ? nodes[id] : undefined;
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`Resolved catalog chain references missing node ${id}`);
	}
	return value;
}
