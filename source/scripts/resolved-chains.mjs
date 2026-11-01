import { createHash } from 'node:crypto';
import { catalogChain } from './chain.mjs';
import { canonicalJsonValue } from './canonical-json.mjs';
import { catalogAt } from './schedule.mjs';

// No release number enters the hash: unchanged paths keep their identity.
export function* resolvedCatalogChains(graph) {
	for (const deploymentId of Object.keys(graph.deployments).sort()) {
		for (const routeId of Object.keys(graph.deployments[deploymentId].routes).sort()) {
			const json = canonicalJsonValue(catalogChain(graph, deploymentId, routeId));
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
// the base graph and of every dated state. Each chain is yielded once, after checking that the
// deployment names it.
export function* everyStateCatalogChains(catalog) {
	const seen = new Set();
	for (const at of [-Infinity, ...catalog.schedule.map(({ start }) => Date.parse(start))]) {
		const graph = catalogAt(catalog, at);
		for (const entry of resolvedCatalogChains(graph)) {
			if (graph.deployments[entry.deploymentId].routes[entry.routeId].chainHash !== entry.hash)
				throw new Error('Compiled catalog chain differs from its history.');
			if (seen.has(entry.hash)) continue;
			seen.add(entry.hash);
			yield entry;
		}
	}
}
