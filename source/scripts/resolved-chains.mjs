import { createHash } from 'node:crypto';
import { canonicalJsonValue } from './canonical-json.mjs';
import { catalogAt } from './schedule.mjs';

// A chain is one executable path from author to provider, with the facts that the deployment
// serves on its route. No release number enters the hash: unchanged paths keep their identity.
export function* resolvedCatalogChains(graph) {
	for (const deploymentId of Object.keys(graph.deployments).sort()) {
		const { routes, ...deployment } = requireNode(graph.deployments, deploymentId);
		const { groupIds: _navigationGroups, ...model } = requireNode(graph.models, deployment.modelId);
		for (const routeId of Object.keys(routes).sort()) {
			const { chainHash: _chainHash, ...routeFacts } = routes[routeId];
			const route = requireNode(graph.routes, routeId);
			const chain = {
				author: { id: model.authorId, data: requireNode(graph.authors, model.authorId) },
				model: { id: deployment.modelId, data: model },
				deployment: { id: deploymentId, data: { ...deployment, ...routeFacts } },
				route: { id: routeId, data: route },
				provider: { id: route.providerId, data: requireNode(graph.providers, route.providerId) }
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
		for (const entry of resolvedCatalogChains(catalogAt(publicCatalog, at))) {
			if (
				runtime.deployments[entry.deploymentId]?.routes[entry.routeId]?.chainHash !== entry.hash
			) {
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
