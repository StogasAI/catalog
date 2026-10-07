import { createHash } from 'node:crypto';
import { canonicalJsonValue } from './canonical-json.mjs';

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
				fileInputsByRoute,
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
						fileInputs: requireNode(fileInputsByRoute, routeId)
					}
				},
				route: {
					id: routeId,
					data: {
						...routeData,
						capabilities: { ...provider.capabilities, ...routeSourceOverrides?.capabilities },
						dataHandling: { ...provider.dataHandling, ...route.dataHandling },
						pricing: mergePricing(provider.pricing, route.pricing)
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

function requireNode(nodes, id) {
	const value = nodes?.[id];
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`Resolved catalog chain references missing node ${id}`);
	}
	return value;
}

function mergePricing(base = {}, overrides = {}) {
	const result = structuredClone(base);
	for (const [meter, rates] of Object.entries(overrides)) {
		result[meter] = { ...result[meter], ...rates };
	}
	return result;
}
