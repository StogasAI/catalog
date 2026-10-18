import { expect, test } from 'bun:test';
import publicCatalog from '../generated/catalog.public.json';
import runtimeCatalog from '../generated/catalog.runtime.json';
import { resolvedCatalogChains } from '../source/scripts/resolved-chains.mjs';

function chains(graph = publicCatalog.graph) {
	return [...resolvedCatalogChains(graph)];
}

test('compiled chain hashes identify individual executable paths and resolved facts', () => {
	const resolved = chains();
	expect(resolved).toHaveLength(
		Object.values(runtimeCatalog.graph.deployments).reduce(
			(sum, deployment) => sum + Object.keys(deployment.routes).length,
			0
		)
	);
	expect(new Set(resolved.map((entry) => entry.hash)).size).toBe(resolved.length);
	for (const entry of resolved) {
		const { chainHash, ...facts } =
			runtimeCatalog.graph.deployments[entry.deploymentId].routes[entry.routeId];
		const chain = JSON.parse(entry.json);
		expect(chainHash).toBe(entry.hash);
		// A chain holds what the deployment serves on its own route and nothing of other routes.
		expect(chain.deployment.data).toMatchObject(facts);
		expect(chain.deployment.data.routes).toBeUndefined();
		expect(chain.route.id).toBe(entry.routeId);
		expect(chain.model.data.groupIds).toBeUndefined();
	}
});

test('node order does not change chain identities', () => {
	const graph = structuredClone(publicCatalog.graph);
	graph.models = Object.fromEntries(Object.entries(graph.models).reverse());
	graph.deployments = Object.fromEntries(Object.entries(graph.deployments).reverse());
	expect(chains(graph)).toEqual(chains());
});

test('changes affect only paths containing the changed node and preserve old content', () => {
	const original = chains();
	const graph = structuredClone(publicCatalog.graph);
	const routeId = 'openai-responses';
	graph.routes[routeId].endpoint = 'https://api.openai.com/v2/responses';
	const updated = chains(graph);
	for (let index = 0; index < original.length; index++) {
		if (original[index].routeId === routeId) {
			expect(updated[index].hash).not.toBe(original[index].hash);
		} else {
			expect(updated[index]).toEqual(original[index]);
		}
	}
	expect(chains()).toEqual(original);
});

test('missing path facts fail instead of producing incomplete historical records', () => {
	const graph = structuredClone(publicCatalog.graph);
	delete (graph.routes as Record<string, unknown>)['openai-responses'];
	expect(() => chains(graph)).toThrow('missing node openai-responses');
});
