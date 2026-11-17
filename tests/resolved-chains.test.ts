import { expect, test } from 'bun:test';
import { catalog } from './generated-catalog';
import { resolvedCatalogChains } from '../source/scripts/resolved-chains.mjs';

function chains(graph = catalog.graph) {
	return [...resolvedCatalogChains(graph)];
}

/** The notes that a record of this kind states itself, or undefined when it states none. */
function own(record: { notes?: { kind: string }[] }, kind: string) {
	const notes = record.notes?.filter((note) => note.kind === kind);
	return notes?.length ? notes : undefined;
}

test('compiled chain hashes identify individual executable paths and resolved facts', () => {
	const resolved = chains();
	expect(resolved).toHaveLength(
		Object.values(catalog.graph.deployments).reduce(
			(sum, deployment) => sum + Object.keys(deployment.routes).length,
			0
		)
	);
	expect(new Set(resolved.map((entry) => entry.hash)).size).toBe(resolved.length);
	for (const entry of resolved) {
		const { chainHash, ...facts } =
			catalog.graph.deployments[entry.deploymentId].routes[entry.routeId];
		const chain = JSON.parse(entry.json);
		expect(chainHash).toBe(entry.hash);
		// A chain holds what the deployment serves on its own route and nothing of other routes.
		expect(chain.deployment.data).toMatchObject(facts);
		expect(chain.deployment.data.routes).toBeUndefined();
		expect(chain.route.id).toBe(entry.routeId);
		expect(chain.model.data.groupIds).toBeUndefined();
		expect(chain.model.data.reasoningEffortsByInterface).toBeUndefined();
		// Each fact appears once: what the deployment states, the model and the route leave out. A
		// route's own retirement date is a fact of the route, apart from the deployment's, and each
		// node keeps only the notes that it states.
		for (const node of [chain.model, chain.route])
			for (const key of Object.keys(node.data))
				if (key !== 'notes' && (node !== chain.route || key !== 'retirementDate'))
					expect(Object.hasOwn(chain.deployment.data, key)).toBe(false);
		expect(chain.model.data.notes).toEqual(catalog.graph.models[chain.model.id].notes);
		expect(chain.route.data.retirementDate).toBe(
			catalog.graph.routes[entry.routeId].retirementDate
		);
		expect(chain.route.data.notes).toEqual(own(catalog.graph.routes[entry.routeId], 'route'));
		expect(chain.deployment.data.notes).toEqual(
			own(catalog.graph.deployments[entry.deploymentId], 'deployment')
		);
		// What the deployment doesn't state, the model and the route keep.
		const {
			groupIds: _groups,
			reasoningEffortsByInterface: _efforts,
			...model
		} = catalog.graph.models[chain.model.id];
		for (const [key, value] of Object.entries(model))
			if (!Object.hasOwn(chain.deployment.data, key)) expect(chain.model.data[key]).toEqual(value);
		for (const [key, value] of Object.entries(catalog.graph.routes[entry.routeId]))
			if (!Object.hasOwn(chain.deployment.data, key)) expect(chain.route.data[key]).toEqual(value);
	}
});

test('a chain shows each fact once, as the path runs it', () => {
	const chain = JSON.parse(
		chains().find(
			(entry) =>
				entry.deploymentId === 'anthropic-claude-fable-5' && entry.routeId === 'anthropic-messages'
		)!.json
	);
	expect(Object.keys(chain.route.data).sort()).toEqual([
		'batch',
		'documentFormats',
		'endpoint',
		'interfaces',
		'providerId',
		'retirementDate'
	]);
	expect(chain.model.data).not.toHaveProperty('maxOutputTokens');
	expect(chain.model.data).toMatchObject({ authorId: 'anthropic', name: 'Claude Fable 5' });
	// The deployment's prices hold on the route, which prices the tools that it runs.
	expect(chain.deployment.data.pricing).toMatchObject({ input_tokens: { per_mill_tokens: '10' } });
	expect(chain.deployment.data.hostedTools.web_search.pricing).toEqual({
		anthropic_web_search_calls: { per_1k_calls: '10' }
	});
});

test("a chain keeps its route's retirement date beside its deployment's", () => {
	const graph = structuredClone(catalog.graph);
	const entry = chains(graph).find(
		(candidate) => Object.keys(graph.deployments[candidate.deploymentId].routes).length > 1
	)!;
	graph.deployments[entry.deploymentId].retirementDate = '2099-01-02';
	graph.routes[entry.routeId].retirementDate = '2099-01-01';
	const chain = JSON.parse(
		chains(graph).find(
			(candidate) =>
				candidate.deploymentId === entry.deploymentId && candidate.routeId === entry.routeId
		)!.json
	);
	expect(chain.deployment.data.retirementDate).toBe('2099-01-02');
	expect(chain.route.data.retirementDate).toBe('2099-01-01');
});

test('node order does not change chain identities', () => {
	const graph = structuredClone(catalog.graph);
	graph.models = Object.fromEntries(Object.entries(graph.models).reverse());
	graph.deployments = Object.fromEntries(Object.entries(graph.deployments).reverse());
	expect(chains(graph)).toEqual(chains());
});

test('changes affect only paths containing the changed node and preserve old content', () => {
	const original = chains();
	const graph = structuredClone(catalog.graph);
	const routeId = 'openai-responses';
	graph.routes[routeId].documentFormats = { extensions: [], mediaTypes: [] };
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
	const graph = structuredClone(catalog.graph);
	delete (graph.routes as Record<string, unknown>)['openai-responses'];
	expect(() => chains(graph)).toThrow('missing node openai-responses');
});
