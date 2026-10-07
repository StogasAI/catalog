import { expect, test } from 'bun:test';
import publicCatalog from '../generated/catalog.public.json';
import runtimeCatalog from '../generated/catalog.runtime.json';
import { resolvedCatalogChains } from '../source/scripts/resolved-chains.mjs';

function chains(publicData = publicCatalog, runtimeData = runtimeCatalog) {
	return [...resolvedCatalogChains(publicData, runtimeData)];
}

test('compiled chain hashes identify individual executable paths and resolved facts', () => {
	const resolved = chains();
	expect(resolved).toHaveLength(
		Object.values(runtimeCatalog.graph.deployments).reduce((sum, d) => sum + d.routeIds.length, 0)
	);
	expect(new Set(resolved.map((entry) => entry.hash)).size).toBe(resolved.length);
	for (const entry of resolved) {
		const deployment = runtimeCatalog.graph.deployments[entry.deploymentId];
		const chain = JSON.parse(entry.json);
		expect(deployment.chainHashes[entry.routeId]).toBe(entry.hash);
		expect(chain.deployment.data.routeIds).toEqual([entry.routeId]);
		expect(chain.deployment.data.dataHandling).toEqual(
			deployment.dataHandlingByRoute[entry.routeId]
		);
		expect(chain.deployment.data.fileInputs).toEqual(deployment.fileInputsByRoute[entry.routeId]);
		expect(chain.deployment.data.fileInputsByRoute).toBeUndefined();
		expect(chain.deployment.data.pricing).toEqual(deployment.pricing);
		expect(chain.deployment.data.reasoningEfforts).toEqual(
			deployment.routeOverrides?.[entry.routeId]?.reasoningEfforts ?? deployment.reasoningEfforts
		);
		expect(chain.deployment.data.chainHashes).toBeUndefined();
		expect(chain.deployment.data.routeOverrides).toBeUndefined();
		expect(chain.deployment.data.overrides).toBeUndefined();
	}
});

test('release metadata and input key order do not change chain identities', () => {
	const publicData = structuredClone(publicCatalog);
	const runtimeData = structuredClone(runtimeCatalog);
	publicData.graph.models = Object.fromEntries(Object.entries(publicData.graph.models).reverse());
	runtimeData.graph.deployments = Object.fromEntries(
		Object.entries(runtimeData.graph.deployments).reverse()
	);
	runtimeData.publicDigest = `sha256:${'f'.repeat(64)}`;
	expect(chains(publicData, runtimeData)).toEqual(chains());
});

test('changes affect only paths containing the changed node and preserve old content', () => {
	const original = chains();
	const publicData = structuredClone(publicCatalog);
	const routeId = 'openai-responses';
	publicData.graph.routes[routeId].endpoint = 'https://api.openai.com/v2/responses';
	const updated = chains(publicData);
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
	const publicData = structuredClone(publicCatalog);
	delete publicData.graph.routes['openai-responses'];
	expect(() => chains(publicData)).toThrow('missing node openai-responses');
});
