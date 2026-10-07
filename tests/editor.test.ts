import { describe, expect, test } from 'bun:test';
import catalogJson from '../generated/catalog.public.json';
import {
	buildFlow,
	completeUnambiguousGraphSelection,
	concreteGraphChains,
	decorateFlow,
	effectiveDeploymentFacts,
	effectiveDeploymentValue,
	extendGraphSelection,
	filterFlow,
	GRAPH_PAGE_SIZE,
	indexGraphPaths,
	lineageForSelection,
	pageGraph,
	parseNodeKey
} from '../editor/src/catalog';
import { readBoundedResponseText } from '../editor/src/http';
import { parseCatalog } from '../editor/src/types';

const catalog = parseCatalog(catalogJson);

describe('effective catalog facts', () => {
	test('keeps a nested group diamond as real edges and one execution choice', () => {
		const fixture = parseCatalog({
			schema: 'stogas.catalog.public.v3',
			graph: {
				authors: { author: { name: 'Author' } },
				groups: {
					root: { authorId: 'author', name: 'Root', parentIds: [] },
					left: { authorId: 'author', name: 'Left', parentIds: ['root'] },
					right: { authorId: 'author', name: 'Right', parentIds: ['root'] },
					leaf: { authorId: 'author', name: 'Leaf', parentIds: ['left', 'right'] }
				},
				models: { model: { authorId: 'author', name: 'Model', groupIds: ['leaf'] } },
				providers: { provider: { name: 'Provider' } },
				routes: { route: { providerId: 'provider' } },
				deployments: { deployment: { modelId: 'model', routeIds: ['route'] } }
			}
		});
		const flow = buildFlow(fixture.graph);
		expect(flow.edges.map((edge) => `${edge.source}->${edge.target}`).sort()).toEqual(
			[
				'author:author->group:root',
				'group:root->group:left',
				'group:root->group:right',
				'group:left->group:leaf',
				'group:right->group:leaf',
				'group:leaf->model:model',
				'model:model->deployment:deployment',
				'route:route->deployment:deployment',
				'provider:provider->route:route'
			].sort()
		);
		const positions = new Map(flow.nodes.map((node) => [node.id, node.position]));
		expect(positions.get('group:left')!.x).toBe(positions.get('group:right')!.x);
		expect(positions.get('group:left')!.y).not.toBe(positions.get('group:right')!.y);
		expect(positions.get('group:leaf')!.x).toBeGreaterThan(positions.get('group:left')!.x);
		const paths = concreteGraphChains(fixture);
		expect(paths).toHaveLength(1);
		expect(new Set(paths[0].edgeIds)).toEqual(new Set(flow.edges.map((edge) => edge.id)));
		expect(lineageForSelection(fixture, 'model:model', {}).map((node) => node.id)).toEqual([
			'author',
			'root',
			'left',
			'right',
			'leaf',
			'model'
		]);
	});
	test('rejects malformed generated catalog collections', () => {
		expect(() => parseCatalog(null)).toThrow('public catalog is invalid');
		expect(() => parseCatalog({ graph: {}, schema: 'wrong' })).toThrow('public catalog is invalid');
		expect(() => parseCatalog({ graph: {}, schema: 'stogas.catalog.public.v3' })).toThrow(
			'authors collection'
		);
		expect(() =>
			parseCatalog({
				graph: { authors: [], deployments: {}, models: {}, providers: {}, routes: {} },
				schema: 'stogas.catalog.public.v3'
			})
		).toThrow('authors collection');
		expect(() =>
			parseCatalog({
				graph: { authors: { bad: [] }, deployments: {}, models: {}, providers: {}, routes: {} },
				schema: 'stogas.catalog.public.v3'
			})
		).toThrow('authors.bad entry');
	});

	test('rejects incomplete graph node keys', () => {
		expect(parseNodeKey('model:')).toBeNull();
		expect(parseNodeKey('unknown:model')).toBeNull();
		expect(parseNodeKey('model:gpt:variant')).toEqual({ type: 'model', id: 'gpt:variant' });
	});

	test('cancels oversized editor API responses', async () => {
		let cancelled = false;
		const response = new Response(
			new ReadableStream<Uint8Array>({
				cancel() {
					cancelled = true;
				}
			}),
			{ headers: { 'content-length': '9' } }
		);
		await expect(readBoundedResponseText(response, 8)).rejects.toThrow('exceeds');
		expect(cancelled).toBe(true);
	});

	test('keeps every route node visible when routes serve the same deployments', () => {
		const flow = buildFlow(catalog.graph);
		const chat = flow.nodes.find((node) => node.id === 'route:azure-chat-completions');
		const responses = flow.nodes.find((node) => node.id === 'route:azure-responses');

		expect(chat).toBeDefined();
		expect(responses).toBeDefined();
		expect(Math.abs((chat?.position.y ?? 0) - (responses?.position.y ?? 0))).toBeGreaterThanOrEqual(
			92
		);
		const routeYs = flow.nodes
			.filter((node) => node.data.type === 'route')
			.map((node) => node.position.y);
		expect(new Set(routeYs).size).toBe(routeYs.length);
	});

	test('places every node in a lane without overlap, including informational models', () => {
		const flow = buildFlow(catalog.graph);
		for (const type of ['author', 'model', 'deployment', 'route', 'provider']) {
			const nodes = flow.nodes.filter((node) => node.data.type === type);
			expect(new Set(nodes.map((node) => node.position.y)).size, type).toBe(nodes.length);
		}
		for (const modelId of ['gemma-4-26b-a4b', 'nemotron-3-super', 'nemotron-3-ultra']) {
			expect(flow.nodes.find((node) => node.id === `model:${modelId}`)?.position.y).toBeDefined();
		}
	});

	test('enumerates one complete chain for every deployment route', () => {
		const chains = concreteGraphChains(catalog);
		const routeReferences = Object.values(catalog.graph.deployments).reduce(
			(total, deployment) => total + (deployment.routeIds as string[]).length,
			0
		);
		expect(chains).toHaveLength(routeReferences);
		for (const chain of chains) {
			expect(chain.nodeKeys.filter((key) => !key.startsWith('group:'))).toHaveLength(5);
			expect(new Set(chain.nodeKeys).size).toBe(chain.nodeKeys.length);
			for (const edge of chain.edgeIds)
				for (const key of edge.split('>')) expect(chain.nodeKeys).toContain(key);
		}
	});

	test('bounds graph pages without losing nodes, paths, or unused resources', () => {
		const fixture = structuredClone(catalog);
		fixture.graph.providers.unused = { name: 'Unused provider' };
		fixture.graph.routes.unused = { providerId: 'unused' };
		fixture.graph.authors.unused = { name: 'Unused author' };
		const index = indexGraphPaths(fixture);
		const options = {
			page: 0,
			query: '',
			selectedKeys: [],
			visibleTypes: {
				author: true,
				group: true,
				model: true,
				deployment: true,
				route: true,
				provider: true
			}
		};
		const first = pageGraph(fixture, index, options);
		const nodes = new Set<string>();
		const edges = new Set<string>();
		for (let page = 0; page < first.pageCount; page++) {
			const result = pageGraph(fixture, index, { ...options, page });
			expect(
				result.flow.nodes.filter((node) => node.data.type === 'deployment').length
			).toBeLessThanOrEqual(GRAPH_PAGE_SIZE);
			const pageNodes = new Set(result.flow.nodes.map((node) => node.id));
			for (const id of pageNodes) nodes.add(id);
			for (const edge of result.flow.edges) {
				expect(pageNodes.has(edge.source)).toBe(true);
				expect(pageNodes.has(edge.target)).toBe(true);
				edges.add(edge.id);
			}
		}
		const complete = buildFlow(fixture.graph);
		expect(nodes).toEqual(new Set(complete.nodes.map((node) => node.id)));
		expect(edges).toEqual(new Set(complete.edges.map((edge) => edge.id)));
		expect(fixture.graph.deployments).toEqual(catalog.graph.deployments);
	});

	test('searches all graph pages, preserves context, and clamps empty or narrowed results', () => {
		const index = indexGraphPaths(catalog);
		const options = {
			page: 999,
			query: 'OPEN-AI',
			selectedKeys: [],
			visibleTypes: {
				author: true,
				group: true,
				model: true,
				deployment: true,
				route: true,
				provider: true
			}
		};
		const result = pageGraph(catalog, index, options);
		expect(result.total).toBeGreaterThan(0);
		expect(result.page).toBe(result.pageCount - 1);
		expect(result.flow.nodes.some((node) => node.data.type === 'deployment')).toBe(true);
		expect(result.flow.nodes.some((node) => node.data.type === 'provider')).toBe(true);
		const missing = pageGraph(catalog, index, { ...options, query: 'missing-catalog-entry' });
		expect(missing).toEqual({ flow: { nodes: [], edges: [] }, total: 0, page: 0, pageCount: 1 });
		const incompatible = pageGraph(catalog, index, {
			...options,
			query: '',
			selectedKeys: ['provider:chutes', 'model:gpt-5.6-sol']
		});
		expect(incompatible.total).toBe(0);
		const hidden = pageGraph(catalog, index, {
			...options,
			visibleTypes: {
				author: false,
				model: false,
				deployment: false,
				route: false,
				provider: false
			}
		});
		expect(hidden.total).toBe(0);
	});

	test('extends and completes only compatible graph selections', () => {
		const flow = buildFlow(catalog.graph);
		const chains = concreteGraphChains(catalog);
		const model = 'model:gpt-5.6-sol';
		const deployment = 'deployment:openai-gpt-5.6-sol';
		const route = 'route:openai-responses';
		const selected = [model];

		expect(extendGraphSelection(flow, chains, [], model)).toEqual([model]);
		expect(extendGraphSelection(flow, chains, selected, model)).toBe(selected);
		expect(extendGraphSelection(flow, chains, [model], 'model:missing')).toBeNull();
		expect(extendGraphSelection(flow, chains, [model], 'provider:chutes')).toBeNull();
		expect(extendGraphSelection(flow, chains, [model], route)).toEqual([model, deployment, route]);
		expect(completeUnambiguousGraphSelection(chains, [deployment, route])).toEqual([
			'author:openai',
			'group:openai-gpt',
			'group:openai-gpt-5.6',
			model,
			deployment,
			route,
			'provider:openai'
		]);
		expect(completeUnambiguousGraphSelection(chains, [model])).toEqual([
			'author:openai',
			'group:openai-gpt',
			'group:openai-gpt-5.6',
			model
		]);
		expect(completeUnambiguousGraphSelection(chains, ['model:missing'])).toEqual(['model:missing']);
	});

	test('decorates and filters compatible graph state without dangling edges', () => {
		const flow = buildFlow(catalog.graph);
		const chains = concreteGraphChains(catalog);
		const visibleTypes = {
			author: true,
			group: true,
			model: true,
			deployment: true,
			route: true,
			provider: true
		};
		const undecorated = decorateFlow(flow, '', '', [], chains);
		expect(undecorated.edges.every((edge) => !edge.hidden)).toBe(true);

		const selected = ['deployment:chutes-glm-5.2'];
		const decorated = decorateFlow(flow, selected[0], '', selected, chains);
		expect(decorated.nodes.find((node) => node.id === selected[0])?.class).toContain(
			'catalog-node-current'
		);
		expect(decorated.edges.some((edge) => edge.hidden)).toBe(true);
		const otherEdgeId = chains.find((chain) => !chain.nodeKeys.includes(selected[0]))?.edgeIds[0];
		expect(otherEdgeId).toBeDefined();
		const forced = decorateFlow(flow, selected[0], otherEdgeId, selected, chains);
		expect(forced.edges.find((edge) => edge.id === otherEdgeId)).toMatchObject({
			hidden: false
		});
		expect(forced.edges.find((edge) => edge.id === otherEdgeId)?.class).toContain(
			'catalog-edge-current'
		);

		const activeEdge = flow.edges[0];
		const active = decorateFlow(
			flow,
			'',
			'',
			[String(activeEdge.source), String(activeEdge.target)],
			chains
		);
		expect(active.edges.find((edge) => edge.id === activeEdge.id)?.class).toContain(
			'catalog-edge-active'
		);

		const unfiltered = filterFlow(flow, visibleTypes, '', [], chains);
		expect(unfiltered.nodes).toHaveLength(flow.nodes.length);
		expect(unfiltered.edges).toHaveLength(flow.edges.length);
		const providersHidden = filterFlow(flow, { ...visibleTypes, provider: false }, '', [], chains);
		expect(providersHidden.nodes.some((node) => node.data.type === 'provider')).toBe(false);
		const providersOnly = filterFlow(flow, visibleTypes, 'provider', [], chains);
		expect(providersOnly.nodes.every((node) => node.data.type === 'provider')).toBe(true);
		expect(providersOnly.edges).toHaveLength(0);
		const incompatible = filterFlow(
			flow,
			visibleTypes,
			'',
			['model:gpt-5.6-sol', 'provider:chutes'],
			chains
		);
		expect(incompatible).toEqual({ nodes: [], edges: [] });

		const filtered = filterFlow(decorated, visibleTypes, 'GLM', selected, chains);
		const nodeIds = new Set(filtered.nodes.map((node) => node.id));
		for (const edge of filtered.edges) {
			expect(nodeIds.has(String(edge.source))).toBe(true);
			expect(nodeIds.has(String(edge.target))).toBe(true);
		}
	});

	test('returns direct lineage only for existing catalog nodes', () => {
		expect(
			lineageForSelection(catalog, 'deployment:chutes-glm-5.2', {
				deploymentId: 'chutes-glm-5.2',
				routeId: 'chutes-chat-completions'
			})
		).toMatchObject([
			{ type: 'author', id: 'z-ai' },
			{ type: 'group', id: 'z-ai-glm' },
			{ type: 'group', id: 'z-ai-glm-5' },
			{ type: 'model', id: 'glm-5.2' },
			{ type: 'deployment', id: 'chutes-glm-5.2' },
			{ type: 'route', id: 'chutes-chat-completions' },
			{ type: 'provider', id: 'chutes' }
		]);
		expect(lineageForSelection(catalog, 'route:openai-responses', {})).toMatchObject([
			{ type: 'route', id: 'openai-responses' },
			{ type: 'provider', id: 'openai' }
		]);
		expect(lineageForSelection(catalog, 'model:gpt-5.6-sol', {})).toMatchObject([
			{ type: 'author', id: 'openai' },
			{ type: 'group', id: 'openai-gpt' },
			{ type: 'group', id: 'openai-gpt-5.6' },
			{ type: 'model', id: 'gpt-5.6-sol' }
		]);
		expect(lineageForSelection(catalog, 'author:openai', {})).toMatchObject([
			{ type: 'author', id: 'openai' }
		]);
		expect(lineageForSelection(catalog, 'provider:chutes', {})).toMatchObject([
			{ type: 'provider', id: 'chutes' }
		]);
		expect(lineageForSelection(catalog, 'invalid', {})).toEqual([]);
		expect(lineageForSelection(catalog, 'model:missing', {})).toEqual([]);
		expect(lineageForSelection(catalog, 'provider:missing', {})).toEqual([]);
	});

	test('shows the semantic owner of inherited and overridden deployment facts', () => {
		const facts = effectiveDeploymentFacts(catalog, 'chutes-glm-5.2');
		const byPath = new Map(facts.map((fact) => [fact.path, fact]));

		expect(byPath.get('contextWindowTokens')?.origin.type).toBe('model');
		expect(byPath.get('reasoning')?.origin.type).toBe('model');
		expect(byPath.get('reasoningEfforts')?.origin.type).toBe('model');
		expect(byPath.get('reasoningMaxTokens')?.origin.type).toBe('model');
		expect(byPath.get('dataHandling.endToEndEncrypted')?.origin.type).toBe('route');
		expect(byPath.get('dataHandling.processingLocation')?.origin.type).toBe('provider');
		expect(byPath.get('dataHandling.tee')?.origin.type).toBe('provider');
		expect(byPath.get('dataHandling.teeVerified')?.origin.type).toBe('provider');
		expect(byPath.get('upstream.chuteId')?.origin.type).toBe('deployment');
		expect(byPath.get('upstream.gpuCount')?.origin.type).toBe('deployment');
	});

	test('attributes route-specific tool pricing to the route that owns it', () => {
		const facts = effectiveDeploymentFacts(catalog, 'openai-gpt-5.6-sol', 'openai-responses');
		const webSearch = facts.find(
			(fact) => fact.path === 'pricing.openai_responses_web_search_calls.per_1k_calls'
		);

		expect(webSearch?.origin).toEqual({ type: 'route', id: 'openai-responses' });
	});

	test('attributes provider-wide tool pricing to the provider that owns it', () => {
		const facts = effectiveDeploymentFacts(
			catalog,
			'anthropic-claude-opus-5',
			'anthropic-messages'
		);
		const webSearch = facts.find(
			(fact) => fact.path === 'pricing.anthropic_web_search_calls.per_1k_calls'
		);

		expect(webSearch?.origin).toEqual({ type: 'provider', id: 'anthropic' });
	});

	test('requires a concrete route and excludes facts from another route', () => {
		expect(effectiveDeploymentFacts(catalog, 'openai-gpt-5.6-sol')).toEqual([]);

		const chatFacts = effectiveDeploymentFacts(
			catalog,
			'openai-gpt-5.6-sol',
			'openai-chat-completions'
		);
		expect(chatFacts.find((fact) => fact.path === 'reasoningEfforts')?.value).toEqual([
			'low',
			'medium',
			'high',
			'xhigh'
		]);
		expect(
			effectiveDeploymentFacts(catalog, 'openai-gpt-5.6-sol', 'openai-responses').find(
				(fact) => fact.path === 'reasoningEfforts'
			)?.value
		).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
		expect(
			chatFacts.some(
				(fact) => fact.path === 'pricing.openai_responses_web_search_calls.per_1k_calls'
			)
		).toBe(false);
	});

	test('rejects a preferred route that is not attached to the deployment', () => {
		for (const deploymentId of ['chutes-glm-5.2', 'openai-gpt-5.6-sol']) {
			expect(effectiveDeploymentFacts(catalog, deploymentId, 'azure-responses')).toEqual([]);
			expect(effectiveDeploymentValue(catalog, deploymentId, 'azure-responses')).toBeNull();
			expect(
				lineageForSelection(catalog, `deployment:${deploymentId}`, {
					deploymentId,
					routeId: 'azure-responses'
				})
			).toEqual([]);
		}
	});

	test('rejects deployment facts and lineage when no route exists', () => {
		expect(effectiveDeploymentFacts(catalog, 'missing')).toEqual([]);
		expect(effectiveDeploymentValue(catalog, 'missing')).toBeNull();
		expect(lineageForSelection(catalog, 'deployment:missing', { deploymentId: 'missing' })).toEqual(
			[]
		);

		const isolated = structuredClone(catalog);
		isolated.graph.deployments['chutes-glm-5.2'].routeIds = [];
		expect(effectiveDeploymentFacts(isolated, 'chutes-glm-5.2')).toEqual([]);
		expect(effectiveDeploymentValue(isolated, 'chutes-glm-5.2')).toBeNull();
		expect(
			lineageForSelection(isolated, 'deployment:chutes-glm-5.2', {
				deploymentId: 'chutes-glm-5.2'
			})
		).toEqual([]);
	});

	test('builds nested resolved JSON for one concrete deployment route', () => {
		const value = effectiveDeploymentValue(
			catalog,
			'openai-gpt-5.6-sol',
			'openai-chat-completions'
		);
		expect(value?.contextWindowTokens).toBe(1_050_000);
		expect((value?.upstream as Record<string, unknown>)?.model).toBe('gpt-5.6-sol');
		const pricing = value?.pricing as Record<string, unknown>;
		expect(pricing.openai_responses_web_search_calls).toBeUndefined();
	});
});

test('attributes provider file formats to routes and deployment overrides independently of model modalities', () => {
	const fixture = structuredClone(catalog);
	const id = 'openai-gpt-5.6-luna';
	expect(effectiveDeploymentFacts(fixture, id, 'openai-chat-completions')).toContainEqual({
		path: 'fileInputs.extensions',
		value: ['.pdf'],
		origin: { type: 'route', id: 'openai-chat-completions' }
	});
	expect(effectiveDeploymentFacts(fixture, id, 'openai-responses')).toContainEqual({
		path: 'fileInputs.extensions',
		value: expect.arrayContaining(['.csv', '.pdf', '.txt']),
		origin: { type: 'route', id: 'openai-responses' }
	});
	fixture.graph.deployments[id].overrides = { fileInputs: { extensions: [], mediaTypes: [] } };
	expect(effectiveDeploymentFacts(fixture, id, 'openai-responses')).toContainEqual({
		path: 'fileInputs.extensions',
		value: [],
		origin: { type: 'deployment', id }
	});
	fixture.graph.deployments[id].overrides = {
		fileInputs: { extensions: ['.md'], mediaTypes: ['text/markdown'] }
	};
	expect(effectiveDeploymentFacts(fixture, id, 'openai-chat-completions')).toContainEqual({
		path: 'fileInputs.extensions',
		value: ['.md'],
		origin: { type: 'deployment', id }
	});
	delete fixture.graph.deployments[id].overrides;
	fixture.graph.models['gpt-5.6-luna'].inputModalities = ['text'];
	expect(effectiveDeploymentFacts(fixture, id, 'openai-chat-completions')).toContainEqual({
		path: 'fileInputs.extensions',
		value: ['.pdf'],
		origin: { type: 'route', id: 'openai-chat-completions' }
	});
});
