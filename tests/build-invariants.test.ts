import { describe, expect, test } from 'bun:test';
import { canonicalJson } from '../source/scripts/canonical-json.mjs';
import { buildCatalogs, main } from '../source/scripts/build.mjs';
import { everyStateCatalogChains } from '../source/scripts/resolved-chains.mjs';
import { catalogAt } from '../source/scripts/schedule.mjs';

type Source = ReturnType<typeof sourceFixture>;
type Mutator = (source: Source) => void;
type RejectionCase = readonly [name: string, mutate: Mutator, message: string | RegExp];

const capabilities = {
	streaming: true,
	functionCalling: true,
	parallelFunctionCalling: true,
	implicitPromptCaching: true,
	explicitPromptCaching: true,
	structuredOutputs: true,
	systemMessages: true,
	toolChoice: true
};

function sourceFixture() {
	return {
		graph: {
			authors: {
				openai: { name: 'OpenAI' }
			},
			models: {
				'gpt-test': {
					authorId: 'openai',
					name: 'GPT Test',
					contextWindowTokens: 1000,
					maxInputTokens: undefined as number | undefined,
					maxOutputTokens: 200,
					inputModalities: ['text', 'image'],
					outputModalities: ['text'],
					reasoning: 'optional',
					reasoningEfforts: ['low', 'high'],
					reasoningMaxTokens: null,
					releaseDate: '2026-01-02'
				}
			},
			providers: {
				openai: {
					name: 'OpenAI',
					credentialModes: ['byok'],
					capabilities: structuredClone(capabilities),
					dataHandling: {
						processingLocation: 'world',
						storageLocation: 'unknown',
						retentionDays: 30,
						trainingUse: false,
						zeroDataRetention: false,
						tee: false,
						teeVerified: false
					}
				}
			},
			routes: {
				'openai-responses': {
					providerId: 'openai',
					endpoint: 'https://api.openai.com/v1/responses',
					interfaces: ['responses'],
					inputModalities: ['text', 'image'],
					documentFormats: { extensions: [] as string[], mediaTypes: [] as string[] },
					dataHandling: { endToEndEncrypted: false }
				}
			},
			deployments: {
				'openai-gpt-test': {
					modelId: 'gpt-test',
					routeIds: ['openai-responses'],
					upstream: { model: 'gpt-test' },
					pricing: {
						input_tokens: { per_mill_tokens: '1' },
						output_tokens: { per_mill_tokens: '2' }
					}
				}
			}
		}
	};
}

function changed(mutator: Mutator) {
	const source = sourceFixture();
	mutator(source);
	return source;
}

function testRejections(cases: RejectionCase[]) {
	test.each(cases)('%s', (_name, mutate, message) => {
		expect(() => buildCatalogs(changed(mutate))).toThrow(message);
	});
}

function chainHash(deployment: { routes: Record<string, { chainHash?: string }> }) {
	return deployment.routes['openai-responses'].chainHash;
}

function setPeriods(node: object, periods: unknown[]) {
	Object.assign(node, { periods });
}

function addSecondOpenAIRoute(source: Source) {
	source.graph.routes['openai-chat-completions'] = {
		providerId: 'openai',
		endpoint: 'https://api.openai.com/v1/chat/completions',
		interfaces: ['chat_completions'],
		inputModalities: ['text', 'image'],
		documentFormats: { extensions: [], mediaTypes: [] },
		dataHandling: { endToEndEncrypted: false }
	};
}

function asAzure(source: Source) {
	source.graph.providers.azure = source.graph.providers.openai;
	delete source.graph.providers.openai;
	source.graph.routes['azure-responses'] = {
		...source.graph.routes['openai-responses'],
		providerId: 'azure'
	};
	delete source.graph.routes['openai-responses'];
	source.graph.deployments['azure-gpt-test'] = {
		...source.graph.deployments['openai-gpt-test'],
		routeIds: ['azure-responses'],
		upstream: {
			model: 'gpt-test',
			modelFormat: 'OpenAI',
			modelVersion: '1',
			hosting: 'azure',
			deploymentType: 'global_standard'
		}
	};
	delete source.graph.deployments['openai-gpt-test'];
}

function asAnthropic(source: Source) {
	source.graph.providers.anthropic = source.graph.providers.openai;
	delete source.graph.providers.openai;
	source.graph.routes['anthropic-messages'] = {
		...source.graph.routes['openai-responses'],
		providerId: 'anthropic'
	};
	delete source.graph.routes['openai-responses'];
	source.graph.deployments['anthropic-gpt-test'] = {
		...source.graph.deployments['openai-gpt-test'],
		routeIds: ['anthropic-messages'],
		upstream: { model: 'gpt-test', inferenceGeo: 'us' }
	};
	delete source.graph.deployments['openai-gpt-test'];
}

function asAzureClaude(source: Source) {
	asAzure(source);
	source.graph.authors.anthropic = { name: 'Anthropic' };
	source.graph.models['gpt-test'].authorId = 'anthropic';
	source.graph.routes['azure-anthropic-messages'] = {
		...source.graph.routes['azure-responses'],
		interfaces: ['chat_completions', 'responses']
	};
	delete source.graph.routes['azure-responses'];
	source.graph.deployments['azure-gpt-test'].routeIds = ['azure-anthropic-messages'];
	source.graph.deployments['azure-gpt-test'].upstream.modelFormat = 'Anthropic';
	source.graph.deployments['azure-gpt-test'].upstream.hosting = 'anthropic';
}

describe('catalog source compiler invariants', () => {
	test('rejects invalid IDs in every collection before interpreting their node fields', () => {
		for (const kind of ['authors', 'groups', 'models', 'providers', 'routes', 'deployments']) {
			for (const id of ['Uppercase', 'has/slash', '__proto__', 'trailing\n', 'a: injected']) {
				const source = sourceFixture();
				source.graph[kind] = { ...source.graph[kind], [id]: { unvalidated: true } };
				expect(() => buildCatalogs(source)).toThrow(`${kind}: invalid node ID`);
			}
		}
	});

	test('compiles nested groups with shared ancestors without changing execution identity', () => {
		const source = sourceFixture();
		const original = buildCatalogs(source);
		source.graph.groups = {
			root: { authorId: 'openai', name: 'Root' },
			left: { authorId: 'openai', name: 'Left', parentIds: ['root'] },
			right: { authorId: 'openai', name: 'Right', parentIds: ['root'] },
			leaf: { authorId: 'openai', name: 'Leaf', parentIds: ['right', 'left'] }
		};
		source.graph.models['gpt-test'].groupIds = ['leaf'];
		const grouped = buildCatalogs(source);
		expect(grouped.public.graph.groups.leaf.parentIds).toEqual(['left', 'right']);
		expect(grouped.public.graph.models['gpt-test'].groupIds).toEqual(['leaf']);
		expect(grouped.runtime.graph.groups).toBeUndefined();
		expect(grouped.runtime.graph.models['gpt-test'].groupIds).toEqual([
			'leaf',
			'left',
			'right',
			'root'
		]);
		expect(chainHash(grouped.runtime.graph.deployments['openai-gpt-test'])).toBe(
			chainHash(original.runtime.graph.deployments['openai-gpt-test'])
		);
		for (const [mutate, message] of [
			[
				(value) => {
					value.graph.groups.root.parentIds = ['leaf'];
				},
				'acyclic'
			],
			[
				(value) => {
					value.graph.groups.leaf.parentIds = ['missing'];
				},
				'missing parent'
			],
			[
				(value) => {
					value.graph.groups.leaf.parentIds = ['left', 'left'];
				},
				'unique list'
			],
			[
				(value) => {
					value.graph.models['gpt-test'].groupIds = ['missing'];
				},
				'missing referenced node'
			],
			[
				(value) => {
					value.graph.authors.other = { name: 'Other' };
					value.graph.groups.leaf.authorId = 'other';
				},
				'another author'
			]
		] as const) {
			const invalid = structuredClone(source);
			mutate(invalid);
			expect(() => buildCatalogs(invalid)).toThrow(message);
		}
	});

	test.each(['0', '0.001', '0.042', '0.000000000000000000000000000000000001', '1000000000000'])(
		'preserves exact rate %s USD in both catalog artifacts',
		(rate) => {
			const source = sourceFixture();
			source.graph.deployments['openai-gpt-test'].pricing.output_tokens.per_mill_tokens = rate;
			const catalogs = buildCatalogs(source);
			for (const artifact of [catalogs.public, catalogs.runtime]) {
				expect(
					artifact.graph.deployments['openai-gpt-test'].routes['openai-responses'].pricing
						.output_tokens.per_mill_tokens
				).toBe(rate);
			}
		}
	);
	test('materializes one minimal graph without leaking public-only policy into runtime', () => {
		const catalogs = buildCatalogs(sourceFixture());
		expect(catalogs.runtime.graph.deployments['openai-gpt-test']).toMatchObject({
			contextWindowTokens: 1000,
			maxOutputTokens: 200,
			routes: { 'openai-responses': { reasoningEfforts: ['low', 'high'] } }
		});
		expect(catalogs.runtime.graph.providers.openai).toEqual({
			aliases: [],
			credentialModes: ['byok'],
			name: 'OpenAI'
		});
		expect(catalogs.public.graph.providers.openai).not.toHaveProperty('moderated');
	});

	test('accepts an alias that respells the model ID', () => {
		const source = sourceFixture();
		Object.assign(source.graph.models['gpt-test'], { aliases: ['gpt.test'] });
		expect(buildCatalogs(source).runtime.graph.models['gpt-test'].aliases).toEqual(['gpt.test']);
	});

	test('is deterministic across source map insertion order', () => {
		const source = sourceFixture();
		const reversed = structuredClone(source);
		reversed.graph = Object.fromEntries(
			Object.entries(reversed.graph).reverse()
		) as Source['graph'];
		for (const key of Object.keys(reversed.graph) as Array<keyof Source['graph']>) {
			reversed.graph[key] = Object.fromEntries(
				Object.entries(reversed.graph[key]).reverse()
			) as never;
		}
		expect(canonicalJson(buildCatalogs(reversed))).toBe(canonicalJson(buildCatalogs(source)));
	});

	describe('rejects invalid references and derivation graphs', () => {
		testRejections([
			[
				'unknown author',
				(source: Source) => (source.graph.models['gpt-test'].authorId = 'missing'),
				'missing referenced node missing'
			],
			[
				'unknown parent',
				(source: Source) => (source.graph.models['gpt-test'].derivedFrom = ['missing']),
				'missing referenced node missing'
			],
			...Object.entries({
				author: (source: Source) => (source.graph.models['gpt-test'].authorId = 'constructor'),
				parent: (source: Source) => (source.graph.models['gpt-test'].derivedFrom = ['constructor']),
				group: (source: Source) => (source.graph.models['gpt-test'].groupIds = ['constructor']),
				provider: (source: Source) =>
					(source.graph.routes['openai-responses'].providerId = 'constructor'),
				model: (source: Source) =>
					(source.graph.deployments['openai-gpt-test'].modelId = 'constructor'),
				route: (source: Source) =>
					(source.graph.deployments['openai-gpt-test'].routeIds = ['constructor'])
			}).map(([kind, mutate]): RejectionCase => [
				`inherited object property as ${kind}`,
				mutate,
				'missing referenced node constructor'
			]),
			[
				'repeated parent',
				(source: Source) =>
					(source.graph.models['gpt-test'].derivedFrom = ['gpt-parent', 'gpt-parent']),
				'derivedFrom must not repeat'
			],
			[
				'cycle',
				(source: Source) => {
					source.graph.models['gpt-parent'] = {
						...structuredClone(source.graph.models['gpt-test']),
						derivedFrom: ['gpt-test']
					};
					source.graph.models['gpt-test'].derivedFrom = ['gpt-parent'];
				},
				/derivedFrom contains a cycle/
			]
		]);

		test('accepts a shared-parent derivation DAG', () => {
			const source = sourceFixture();
			for (const modelId of ['gpt-parent', 'gpt-sibling']) {
				source.graph.models[modelId] = structuredClone(source.graph.models['gpt-test']);
			}
			source.graph.models['gpt-test'].derivedFrom = ['gpt-parent', 'gpt-sibling'];
			source.graph.models['gpt-sibling'].derivedFrom = ['gpt-parent'];
			expect(buildCatalogs(source).public.graph.models['gpt-test'].derivedFrom).toEqual([
				'gpt-parent',
				'gpt-sibling'
			]);
		});
	});

	describe('rejects invalid model dates, limits, modalities, and reasoning', () => {
		testRejections([
			[
				'impossible release date',
				(source: Source) => (source.graph.models['gpt-test'].releaseDate = '2026-02-30'),
				'releaseDate is invalid'
			],
			[
				'invalid knowledge cutoff',
				(source: Source) => (source.graph.models['gpt-test'].knowledgeCutoff = '2026-13-01'),
				'knowledgeCutoff is invalid'
			],
			[
				'impossible snapshot date',
				(source: Source) => (source.graph.models['gpt-test'].snapshot = '2026-04-31'),
				'snapshot is invalid'
			],
			[
				'output exceeds context',
				(source: Source) => (source.graph.models['gpt-test'].maxOutputTokens = 1001),
				'output limit must fit inside the context window'
			],
			[
				'duplicate modality',
				(source: Source) => (source.graph.models['gpt-test'].inputModalities = ['text', 'text']),
				'inputModalities must use canonical order without repeats'
			],
			[
				'out-of-order modality',
				(source: Source) => (source.graph.models['gpt-test'].inputModalities = ['image', 'text']),
				'inputModalities must use canonical order without repeats'
			],
			[
				'unknown output modality',
				(source: Source) => (source.graph.models['gpt-test'].outputModalities = ['future']),
				'outputModalities must use canonical order without repeats'
			],
			[
				'out-of-order effort',
				(source: Source) => (source.graph.models['gpt-test'].reasoningEfforts = ['high', 'low']),
				'reasoningEfforts must use canonical order without repeats'
			],
			[
				'unsupported controls',
				(source: Source) => (source.graph.models['gpt-test'].reasoning = 'unsupported'),
				'unsupported reasoning cannot expose controls'
			],
			[
				'nonpositive manual bound',
				(source: Source) =>
					(source.graph.models['gpt-test'].reasoningMaxTokens = { minimum: 0, maximum: 10 }),
				'invalid manual reasoning token bounds'
			],
			[
				'reversed manual bounds',
				(source: Source) =>
					(source.graph.models['gpt-test'].reasoningMaxTokens = { minimum: 11, maximum: 10 }),
				'invalid manual reasoning token bounds'
			],
			[
				'manual bound consumes all output',
				(source: Source) =>
					(source.graph.models['gpt-test'].reasoningMaxTokens = { minimum: 1, maximum: 200 }),
				'invalid manual reasoning token bounds'
			]
		]);
	});

	test('accepts exact date and manual-reasoning boundaries', () => {
		const source = sourceFixture();
		source.graph.models['gpt-test'].snapshot = '2026-01-02';
		source.graph.models['gpt-test'].reasoningMaxTokens = { minimum: 1, maximum: 199 };
		asAzureClaude(source);
		source.graph.deployments['azure-gpt-test'].overrides = {
			dataHandling: { processingLocation: 'unknown' }
		};
		const catalogs = buildCatalogs(source);
		expect(catalogs.public.graph.models['gpt-test']).toMatchObject({
			snapshot: '2026-01-02',
			reasoningMaxTokens: { minimum: 1, maximum: 199 }
		});

		const deploymentBoundary = sourceFixture();
		Object.assign(deploymentBoundary.graph.deployments['openai-gpt-test'], {
			retirementDate: '2026-01-02'
		});
		expect(
			buildCatalogs(deploymentBoundary).runtime.graph.deployments['openai-gpt-test'].retirementDate
		).toBe('2026-01-02');
	});

	testRejections([
		[
			'rejects deployment retirement before the model release',
			(source) => {
				Object.assign(source.graph.deployments['openai-gpt-test'], {
					retirementDate: '2026-01-01'
				});
			},
			'retirementDate precedes model releaseDate'
		],
		[
			'rejects an impossible deployment retirement date',
			(source) => {
				Object.assign(source.graph.deployments['openai-gpt-test'], {
					retirementDate: '2026-02-30'
				});
			},
			'retirementDate is invalid'
		]
	]);

	test('compiles dated periods into a schedule of whole changed nodes', () => {
		const source = sourceFixture();
		setPeriods(source.graph.deployments['openai-gpt-test'], [
			{
				name: 'November output discount',
				start: '2026-11-01T00:00:00Z',
				end: '2026-12-01T00:00:00Z',
				set: { 'pricing.output_tokens.per_mill_tokens': '1' }
			},
			{
				name: 'Lower input price',
				start: '2026-12-01T00:00:00Z',
				set: { 'pricing.input_tokens.per_mill_tokens': '0.5' }
			}
		]);
		setPeriods(source.graph.models['gpt-test'], [
			{
				name: 'Output limit test',
				start: '2026-11-15T00:00:00Z',
				end: '2026-11-20T00:00:00Z',
				set: { maxOutputTokens: 100 },
				unset: ['reasoningEfforts']
			}
		]);
		const catalogs = buildCatalogs(source);
		const base = buildCatalogs(sourceFixture());
		expect(catalogs.runtime.graph).toEqual(base.runtime.graph);
		expect(catalogs.public.graph).toEqual(base.public.graph);
		expect(base.runtime.schedule).toEqual([]);

		const [promotion, limited, promotionAgain, raised] = catalogs.runtime.schedule;
		expect(catalogs.runtime.schedule.map(({ start }) => start)).toEqual([
			'2026-11-01T00:00:00Z',
			'2026-11-15T00:00:00Z',
			'2026-11-20T00:00:00Z',
			'2026-12-01T00:00:00Z'
		]);
		const baseDeployment = base.runtime.graph.deployments['openai-gpt-test'];
		expect(Object.keys(promotion.graph)).toEqual(['deployments']);
		const route = (deployment: { routes: Record<string, Record<string, unknown>> }) =>
			deployment.routes['openai-responses'];
		expect(route(promotion.graph.deployments['openai-gpt-test']).pricing).toEqual({
			input_tokens: { per_mill_tokens: '1' },
			output_tokens: { per_mill_tokens: '1' }
		});
		expect(chainHash(promotion.graph.deployments['openai-gpt-test'])).not.toBe(
			chainHash(baseDeployment)
		);
		expect(limited.graph.models['gpt-test']).toMatchObject({
			maxOutputTokens: 100,
			reasoningEfforts: []
		});
		expect(limited.graph.deployments['openai-gpt-test']).toMatchObject({
			maxOutputTokens: 100,
			routes: {
				'openai-responses': {
					reasoningEfforts: [],
					pricing: { output_tokens: { per_mill_tokens: '1' } }
				}
			}
		});
		expect(promotionAgain.graph).toEqual(promotion.graph);
		expect(route(raised.graph.deployments['openai-gpt-test']).pricing).toEqual({
			input_tokens: { per_mill_tokens: '0.5' },
			output_tokens: { per_mill_tokens: '2' }
		});
		const publicBase = base.public.graph.deployments['openai-gpt-test'];
		expect(catalogs.public.schedule[0].graph).toEqual({
			deployments: {
				'openai-gpt-test': {
					...publicBase,
					routes: {
						'openai-responses': {
							...route(publicBase),
							pricing: {
								input_tokens: { per_mill_tokens: '1' },
								output_tokens: { per_mill_tokens: '1' }
							}
						}
					}
				}
			}
		});

		expect(catalogs.public.periods).toEqual([
			{
				kind: 'deployments',
				id: 'openai-gpt-test',
				name: 'November output discount',
				start: '2026-11-01T00:00:00Z',
				end: '2026-12-01T00:00:00Z'
			},
			{
				kind: 'models',
				id: 'gpt-test',
				name: 'Output limit test',
				start: '2026-11-15T00:00:00Z',
				end: '2026-11-20T00:00:00Z'
			},
			{
				kind: 'deployments',
				id: 'openai-gpt-test',
				name: 'Lower input price',
				start: '2026-12-01T00:00:00Z',
				end: null
			}
		]);
		expect(base.public.periods).toEqual([]);

		// History holds each chain that a request could log, once.
		expect(
			[...everyStateCatalogChains(catalogs.public, catalogs.runtime)].map((entry) => entry.hash)
		).toEqual([
			chainHash(baseDeployment),
			chainHash(promotion.graph.deployments['openai-gpt-test']),
			chainHash(limited.graph.deployments['openai-gpt-test']),
			chainHash(raised.graph.deployments['openai-gpt-test'])
		]);
		const altered = structuredClone(catalogs.runtime);
		altered.schedule[1].graph.deployments['openai-gpt-test'].routes['openai-responses'].chainHash =
			chainHash(baseDeployment);
		expect(() => [...everyStateCatalogChains(catalogs.public, altered)]).toThrow(
			'Compiled catalog chain differs from its history.'
		);

		const at = (time: string) => catalogAt(catalogs.runtime, new Date(time));
		expect(at('2026-10-31T23:59:59Z')).toEqual(base.runtime.graph);
		expect(at('2026-11-01T00:00:00Z').deployments['openai-gpt-test']).toEqual(
			promotion.graph.deployments['openai-gpt-test']
		);
		expect(at('2026-11-19T23:59:59Z').models['gpt-test'].maxOutputTokens).toBe(100);
		expect(route(at('2027-01-01T00:00:00Z').deployments['openai-gpt-test']).pricing).toMatchObject({
			input_tokens: { per_mill_tokens: '0.5' }
		});
	});

	test('returns to the base graph when the last period ends', () => {
		const source = sourceFixture();
		setPeriods(source.graph.authors.openai, [
			{
				name: 'Rename test',
				start: '2026-11-01T00:00:00Z',
				end: '2026-11-02T00:00:00Z',
				set: { name: 'OpenAI Labs' }
			}
		]);
		const { runtime, public: publicCatalog } = buildCatalogs(source);
		expect(runtime.schedule).toHaveLength(2);
		expect(runtime.schedule[0].graph.authors.openai.name).toBe('OpenAI Labs');
		expect(Object.keys(runtime.schedule[0].graph.deployments)).toEqual(['openai-gpt-test']);
		expect(runtime.schedule[1]).toEqual({ start: '2026-11-02T00:00:00Z', graph: {} });
		expect(publicCatalog.schedule.map(({ graph }) => Object.keys(graph))).toEqual([
			['authors'],
			[]
		]);
	});

	test('archives retired deployments, and models with none left, as they last were', () => {
		const source = sourceFixture();
		const deployment = source.graph.deployments['openai-gpt-test'];
		const { models, deployments } = source.graph;
		models['gpt-other'] = { ...models['gpt-test'], name: 'GPT Other' };
		models['gpt-listed'] = { ...models['gpt-test'], name: 'GPT Listed' };
		deployments['openai-gpt-later'] = {
			...structuredClone(deployment),
			upstream: { model: 'gpt-later' },
			retirementDate: '2026-09-01'
		};
		deployments['openai-gpt-other'] = {
			...structuredClone(deployment),
			modelId: 'gpt-other',
			upstream: { model: 'gpt-other' },
			retirementDate: '2026-05-01'
		};
		Object.assign(deployment, { retirementDate: '2026-06-01' });
		setPeriods(deployment, [
			{
				name: 'Last price',
				start: '2026-05-01T00:00:00Z',
				set: { 'pricing.input_tokens.per_mill_tokens': '0.5' }
			}
		]);
		const whole = buildCatalogs(source);
		expect(whole.archive).toBeNull();
		expect(whole.runtime.retired).toEqual({ deployments: {}, models: {} });
		expect(buildCatalogs(source, '2026-04-30').archive).toBeNull();

		const { archive, public: publicCatalog, runtime } = buildCatalogs(source, '2026-06-01');
		const lastState = whole.public.schedule[0].graph.deployments['openai-gpt-test'];
		expect(lastState.routes['openai-responses'].pricing.input_tokens).toEqual({
			per_mill_tokens: '0.5'
		});
		expect(archive).toEqual({
			schema: 'stogas.catalog.archive.v1',
			graph: {
				deployments: {
					'openai-gpt-other': whole.public.graph.deployments['openai-gpt-other'],
					'openai-gpt-test': lastState
				},
				models: { 'gpt-other': whole.public.graph.models['gpt-other'] }
			}
		});
		expect(runtime.retired).toEqual({
			deployments: { 'openai-gpt-other': '2026-05-01', 'openai-gpt-test': '2026-06-01' },
			models: { 'gpt-other': '2026-05-01' }
		});
		// The public catalog lists a model without deployments; the runtime omits it.
		expect(Object.keys(publicCatalog.graph.models).sort()).toEqual(['gpt-listed', 'gpt-test']);
		expect(Object.keys(runtime.graph.models)).toEqual(['gpt-test']);
		for (const catalog of [publicCatalog, runtime]) {
			expect(Object.keys(catalog.graph.deployments)).toEqual(['openai-gpt-later']);
			// The only period belonged to an archived deployment.
			expect(catalog.schedule).toEqual([]);
		}
		expect(publicCatalog.periods).toEqual([]);
		expect(publicCatalog.graph.routes).toEqual(whole.public.graph.routes);
	});

	testRejections([
		[
			'rejects a period that ends when it starts',
			(source) =>
				setPeriods(source.graph.deployments['openai-gpt-test'], [
					{
						name: 'Test',
						start: '2026-12-01T00:00:00Z',
						end: '2026-12-01T00:00:00Z',
						set: { name: 'x' }
					}
				]),
			'must end after it starts'
		],
		[
			'rejects overlapping periods',
			(source) =>
				setPeriods(source.graph.models['gpt-test'], [
					{
						name: 'Test',
						start: '2026-11-01T00:00:00Z',
						end: '2026-12-01T00:00:01Z',
						set: { name: 'A' }
					},
					{ name: 'Test', start: '2026-12-01T00:00:00Z', set: { name: 'B' } }
				]),
			'models.gpt-test.periods[1] must start after the period before it ends'
		],
		[
			'rejects a period after one without an end',
			(source) =>
				setPeriods(source.graph.models['gpt-test'], [
					{ name: 'Test', start: '2026-11-01T00:00:00Z', set: { name: 'A' } },
					{ name: 'Test', start: '2026-12-01T00:00:00Z', set: { name: 'B' } }
				]),
			'must start after the period before it ends'
		],
		[
			'rejects an impossible period time',
			(source) =>
				setPeriods(source.graph.models['gpt-test'], [
					{ name: 'Test', start: '2026-02-30T00:00:00Z', set: { name: 'A' } }
				]),
			'has an invalid time 2026-02-30T00:00:00Z'
		],
		[
			'rejects a period that changes nothing',
			(source) =>
				setPeriods(source.graph.models['gpt-test'], [
					{ name: 'Test', start: '2026-11-01T00:00:00Z', set: {} }
				]),
			'models.gpt-test.periods[0] changes nothing'
		],
		[
			'rejects a period that repeats a value',
			(source) =>
				setPeriods(source.graph.deployments['openai-gpt-test'], [
					{
						name: 'Test',
						start: '2026-11-01T00:00:00Z',
						set: { 'pricing.input_tokens.per_mill_tokens': '1' }
					}
				]),
			'sets pricing.input_tokens.per_mill_tokens to the value it already has'
		],
		[
			'rejects unsetting a missing field',
			(source) =>
				setPeriods(source.graph.models['gpt-test'], [
					{ name: 'Test', start: '2026-11-01T00:00:00Z', unset: ['knowledgeCutoff'] }
				]),
			'unsets knowledgeCutoff, which the node does not have'
		],
		[
			'rejects a period that moves a node',
			(source) =>
				setPeriods(source.graph.deployments['openai-gpt-test'], [
					{ name: 'Test', start: '2026-11-01T00:00:00Z', set: { modelId: 'other' } }
				]),
			'cannot change modelId; add or edit nodes instead'
		],
		[
			'rejects a period that moves a retirement',
			(source) =>
				setPeriods(source.graph.deployments['openai-gpt-test'], [
					{ name: 'Test', start: '2026-11-01T00:00:00Z', set: { retirementDate: '2027-01-01' } }
				]),
			'cannot change retirementDate'
		],
		[
			'rejects a period that changes a field and its parent',
			(source) =>
				setPeriods(source.graph.deployments['openai-gpt-test'], [
					{
						name: 'Test',
						start: '2026-11-01T00:00:00Z',
						set: { 'pricing.input_tokens.per_mill_tokens': '3' },
						unset: ['pricing']
					}
				]),
			'changes both pricing and pricing.input_tokens.per_mill_tokens'
		],
		[
			'rejects a path through a list',
			(source) =>
				setPeriods(source.graph.models['gpt-test'], [
					{ name: 'Test', start: '2026-11-01T00:00:00Z', set: { 'inputModalities.text': true } }
				]),
			'inputModalities.text passes through a value that is not an object'
		],
		[
			'rejects a dated state that breaks a graph invariant',
			(source) =>
				setPeriods(source.graph.models['gpt-test'], [
					{ name: 'Test', start: '2026-11-01T00:00:00Z', set: { maxOutputTokens: 1001 } }
				]),
			'output limit must fit inside the context window'
		],
		[
			'rejects a dated long prompt price at the input limit',
			(source) =>
				setPeriods(source.graph.deployments['openai-gpt-test'], [
					{
						name: 'Test',
						start: '2026-11-01T00:00:00Z',
						set: { 'pricing.input_tokens.per_mill_context_gt_1k': '2' }
					}
				]),
			'openai-gpt-test.pricing.input_tokens.per_mill_context_gt_1k must be below the input limit'
		]
	]);

	describe('permits only deployment narrowing and real overrides', () => {
		test('keeps independent input and combined context limits', () => {
			const source = sourceFixture();
			const base = buildCatalogs(source).runtime.graph.deployments['openai-gpt-test'];
			expect(base.maxInputTokens).toBe(1000);
			source.graph.models['gpt-test'].maxInputTokens = 900;
			source.graph.deployments['openai-gpt-test'].overrides = { contextWindowTokens: 800 };
			expect(
				buildCatalogs(source).runtime.graph.deployments['openai-gpt-test'].maxInputTokens
			).toBe(800);
			delete source.graph.deployments['openai-gpt-test'].overrides;
			expect(
				buildCatalogs(source).runtime.graph.deployments['openai-gpt-test'].maxInputTokens
			).toBe(900);
			source.graph.models['gpt-test'].maxInputTokens = 1001;
			expect(() => buildCatalogs(source)).toThrow('input limit must fit inside');
		});

		test('materializes valid narrowing', () => {
			const valid = changed((source) => {
				source.graph.deployments['openai-gpt-test'].overrides = {
					contextWindowTokens: 800,
					maxOutputTokens: 100,
					capabilities: { structuredOutputs: false },
					reasoningEfforts: ['high']
				};
			});
			expect(buildCatalogs(valid).runtime.graph.deployments['openai-gpt-test']).toMatchObject({
				contextWindowTokens: 800,
				maxOutputTokens: 100,
				routes: {
					'openai-responses': {
						capabilities: { structuredOutputs: false },
						reasoningEfforts: ['high']
					}
				}
			});
		});

		testRejections([
			[
				'redundant context',
				(source: Source) =>
					(source.graph.deployments['openai-gpt-test'].overrides = {
						contextWindowTokens: 1000
					}),
				'overrides.contextWindowTokens does not change what the deployment serves'
			],
			[
				'capability the model already lacks',
				(source: Source) => {
					source.graph.models['gpt-test'].capabilities = { structuredOutputs: false };
					source.graph.deployments['openai-gpt-test'].overrides = {
						capabilities: { structuredOutputs: false }
					};
				},
				'overrides.capabilities.structuredOutputs does not change what the deployment serves'
			],
			[
				'wider context',
				(source: Source) =>
					(source.graph.deployments['openai-gpt-test'].overrides = {
						contextWindowTokens: 1001
					}),
				'context limit may only narrow'
			],
			[
				'wider output',
				(source: Source) =>
					(source.graph.deployments['openai-gpt-test'].overrides = { maxOutputTokens: 201 }),
				'output limit may only narrow'
			],
			[
				'output outside narrowed context',
				(source: Source) =>
					(source.graph.deployments['openai-gpt-test'].overrides = {
						contextWindowTokens: 100,
						maxOutputTokens: 150
					}),
				'output limit must fit inside the context window'
			],
			[
				'enabled capability',
				(source: Source) => {
					source.graph.providers.openai.capabilities.structuredOutputs = false;
					source.graph.deployments['openai-gpt-test'].overrides = {
						capabilities: { structuredOutputs: true }
					};
				},
				'overrides.capabilities.structuredOutputs may only remove a capability'
			],
			[
				'new effort',
				(source: Source) =>
					(source.graph.deployments['openai-gpt-test'].overrides = {
						reasoningEfforts: ['low', 'medium']
					}),
				'reasoning effort medium is absent from the model'
			],
			[
				'interface effort outside the model',
				(source: Source) =>
					Object.assign(source.graph.models['gpt-test'], {
						reasoningEffortsByInterface: { responses: ['medium'] }
					}),
				'reasoningEffortsByInterface.responses must be a subset of reasoningEfforts'
			],
			[
				'interface efforts that repeat the model',
				(source: Source) =>
					Object.assign(source.graph.models['gpt-test'], {
						reasoningEffortsByInterface: { responses: ['low', 'high'] }
					}),
				'reasoningEffortsByInterface.responses redundantly repeats reasoningEfforts'
			]
		]);

		test('narrows efforts on routes that pass one interface through to the provider', () => {
			const source = sourceFixture();
			Object.assign(source.graph.models['gpt-test'], {
				reasoningEffortsByInterface: { responses: ['low'] }
			});
			addSecondOpenAIRoute(source);
			source.graph.deployments['openai-gpt-test'].routeIds.push('openai-chat-completions');
			const efforts = () =>
				Object.fromEntries(
					Object.entries(
						buildCatalogs(source).runtime.graph.deployments['openai-gpt-test'].routes
					).map(([routeId, route]) => [routeId, route.reasoningEfforts])
				);
			expect(efforts()).toEqual({
				'openai-chat-completions': ['low', 'high'],
				'openai-responses': ['low']
			});

			// A route that translates several interfaces keeps the deployment's list.
			source.graph.deployments['openai-gpt-test'].routeIds = ['openai-responses'];
			source.graph.routes['openai-responses'].interfaces = ['chat_completions', 'responses'];
			expect(efforts()).toEqual({ 'openai-responses': ['low', 'high'] });

			source.graph.routes['openai-responses'].interfaces = ['responses'];
			source.graph.deployments['openai-gpt-test'].overrides = { reasoningEfforts: ['high'] };
			expect(efforts()).toEqual({ 'openai-responses': [] });
		});

		test('keeps facts that differ between routes on each route', () => {
			const source = sourceFixture();
			addSecondOpenAIRoute(source);
			source.graph.routes['openai-chat-completions'].overrides = {
				capabilities: { streaming: false }
			};
			source.graph.routes['openai-chat-completions'].inputModalities = ['text'];
			source.graph.routes['openai-responses'].pricing = {
				openai_responses_web_search_calls: { per_1k_calls: '10' }
			};
			source.graph.deployments['openai-gpt-test'].routeIds.push('openai-chat-completions');
			const { routes } = buildCatalogs(source).runtime.graph.deployments['openai-gpt-test'];
			expect(routes['openai-chat-completions'].capabilities.streaming).toBe(false);
			expect(routes['openai-responses'].capabilities.streaming).toBe(true);
			expect(routes['openai-chat-completions'].inputModalities).toEqual(['text']);
			expect(routes['openai-responses'].inputModalities).toEqual(['text', 'image']);
			expect(Object.keys(routes['openai-chat-completions'].pricing)).toEqual([
				'input_tokens',
				'output_tokens'
			]);
			expect(routes['openai-responses'].pricing.openai_responses_web_search_calls).toEqual({
				per_1k_calls: '10'
			});
		});
	});

	test('rejects contradictory data handling while allowing valid TEE and zero retention', () => {
		expect(() =>
			buildCatalogs(
				changed((source) => {
					source.graph.providers.openai.dataHandling.teeVerified = true;
				})
			)
		).toThrow('verified TEE handling requires TEE processing');
		expect(() =>
			buildCatalogs(
				changed((source) => {
					source.graph.deployments['openai-gpt-test'].overrides = {
						dataHandling: { teeVerified: true }
					};
				})
			)
		).toThrow('verified TEE handling requires TEE processing');

		for (const override of [
			{ zeroDataRetention: true },
			{ zeroDataRetention: true, storageLocation: 'none', retentionDays: 1 },
			{
				zeroDataRetention: true,
				storageLocation: 'none',
				retentionDays: 0,
				trainingUse: true
			}
		]) {
			expect(() =>
				buildCatalogs(
					changed((source) => {
						source.graph.deployments['openai-gpt-test'].overrides = {
							dataHandling: override
						};
					})
				)
			).toThrow('zero data retention conflicts with data handling');
		}

		const valid = changed((source) => {
			source.graph.providers.openai.dataHandling = {
				...source.graph.providers.openai.dataHandling,
				storageLocation: 'none',
				retentionDays: 0,
				zeroDataRetention: true,
				tee: true,
				teeVerified: true
			};
			source.graph.deployments['openai-gpt-test'].overrides = {
				dataHandling: { teeVerified: false }
			};
		});
		const handling =
			buildCatalogs(valid).runtime.graph.deployments['openai-gpt-test'].routes['openai-responses']
				.dataHandling;
		expect(handling).toMatchObject({
			storageLocation: 'none',
			retentionDays: 0,
			zeroDataRetention: true,
			tee: true,
			teeVerified: false
		});
	});

	test('validates provider-owned data handling even when a route masks the contradiction', () => {
		expect(() =>
			buildCatalogs(
				changed((source) => {
					source.graph.providers.openai.dataHandling.zeroDataRetention = true;
					Object.assign(source.graph.routes['openai-responses'].dataHandling, {
						storageLocation: 'none',
						retentionDays: 0
					});
				})
			)
		).toThrow('zero data retention conflicts with data handling');
	});

	describe('accepts only canonical route endpoints and provider credential modes', () => {
		test('accepts an omitted endpoint and canonical credential order', () => {
			const source = changed((candidate) => {
				delete candidate.graph.routes['openai-responses'].endpoint;
				candidate.graph.providers.openai.credentialModes = ['managed', 'byok'];
			});
			expect(
				buildCatalogs(source).runtime.graph.routes['openai-responses'].endpoint
			).toBeUndefined();
		});

		testRejections([
			...[
				'not-a-url',
				'http://api.openai.com/v1/responses',
				'https://user:secret@api.openai.com/v1/responses',
				'https://api.openai.com/v1/responses?debug=true',
				'https://api.openai.com/v1/responses#fragment',
				' https://api.openai.com/v1/responses',
				'https://api.openai.com/v1/\nresponses'
			].map((endpoint): RejectionCase => [
				`rejects endpoint ${JSON.stringify(endpoint)}`,
				(source) => {
					source.graph.routes['openai-responses'].endpoint = endpoint;
				},
				'endpoint must be a canonical HTTPS URL'
			]),
			...([[], ['byok', 'managed'], ['byok', 'byok'], ['future']] as string[][]).map(
				(credentialModes): RejectionCase => [
					`rejects credential modes ${JSON.stringify(credentialModes)}`,
					(source) => {
						source.graph.providers.openai.credentialModes = credentialModes;
					},
					'credentialModes must'
				]
			),
			...[[], ['responses', 'responses'], ['responses', 'chat_completions'], ['future']].map(
				(interfaces): RejectionCase => [
					`rejects interfaces ${JSON.stringify(interfaces)}`,
					(source) => {
						source.graph.routes['openai-responses'].interfaces = interfaces;
					},
					'interfaces must'
				]
			)
		]);
	});

	describe('rejects route, pricing, selector, and alias ambiguity', () => {
		testRejections([
			[
				'duplicate route',
				(source: Source) =>
					(source.graph.deployments['openai-gpt-test'].routeIds = [
						'openai-responses',
						'openai-responses'
					]),
				'routes must serve different interfaces'
			],
			[
				'mixed providers',
				(source: Source) => {
					source.graph.providers.anthropic = {
						...structuredClone(source.graph.providers.openai),
						name: 'Anthropic'
					};
					source.graph.routes['anthropic-messages'] = {
						...structuredClone(source.graph.routes['openai-responses']),
						providerId: 'anthropic'
					};
					source.graph.deployments['openai-gpt-test'].routeIds.push('anthropic-messages');
				},
				'all routes must belong to one provider'
			],
			[
				'direct repetition of inherited pricing',
				(source: Source) => {
					source.graph.routes['openai-responses'].pricing = {
						openai_responses_web_search_calls: { per_1k_calls: '1' }
					};
					(source.graph.deployments['openai-gpt-test'].pricing as Record<string, unknown>)[
						'openai_responses_web_search_calls'
					] = { per_1k_calls: '2' };
				},
				'openai-gpt-test.pricing.openai_responses_web_search_calls repeats a price of route openai-responses'
			],
			[
				'long prompt price that no prompt can reach',
				(source: Source) =>
					Object.assign(source.graph.deployments['openai-gpt-test'].pricing.input_tokens, {
						per_mill_context_gt_1k: '2'
					}),
				'openai-gpt-test.pricing.input_tokens.per_mill_context_gt_1k must be below the input limit'
			],
			[
				'wrong selector shape',
				(source: Source) =>
					((source.graph.deployments['openai-gpt-test'].upstream as Record<string, unknown>)[
						'chuteId'
					] = 'not-allowed'),
				'upstream selector does not match provider openai'
			],
			[
				'model/deployment selector collision',
				(source: Source) => {
					source.graph.deployments = { 'gpt-test': source.graph.deployments['openai-gpt-test'] };
				},
				'gpt-test selects both model:gpt-test and deployment:gpt-test'
			],
			[
				'model/group selector collision',
				(source: Source) =>
					Object.assign(source.graph, {
						groups: { 'gpt-test': { authorId: 'openai', name: 'GPT Test' } }
					}),
				'gpt-test selects both model:gpt-test and group:gpt-test'
			],
			[
				'alias that names another model',
				(source: Source) => (source.graph.models['gpt-test'].aliases = ['gpt-latest']),
				'gpt-test: alias gpt-latest may differ from the ID only in dots and dashes'
			],
			[
				'noncanonical qualifier',
				(source: Source) =>
					Object.assign(source.graph.providers.openai, { aliases: ['bad/alias'] }),
				'provider openai: qualifier bad/alias is not canonical'
			],
			[
				'too many aliases',
				(source: Source) =>
					Object.assign(source.graph.providers.openai, {
						aliases: Array.from({ length: 9 }, (_, index) => `alias-${index}`)
					}),
				'provider openai: select at most 8 aliases'
			],
			[
				'missing canonical base',
				(source: Source) => {
					const deployment = source.graph.deployments['openai-gpt-test'];
					source.graph.deployments = {
						'openai-gpt-test-a': structuredClone(deployment),
						'openai-gpt-test-b': structuredClone(deployment)
					};
				},
				'multiple deployments require canonical base openai-gpt-test'
			]
		]);
	});

	test('keeps Azure rules structural instead of model-name allowlists', () => {
		for (const modelFormat of ['OpenAI', 'OpenAI-OSS', 'DeepSeek']) {
			const source = changed(asAzure);
			source.graph.deployments['azure-gpt-test'].upstream.modelFormat = modelFormat;
			expect(
				buildCatalogs(source).runtime.graph.deployments['azure-gpt-test'].upstream.modelFormat
			).toBe(modelFormat);
		}
		const fast = changed((source) => {
			asAzure(source);
			source.graph.deployments['azure-gpt-test-fast'] = structuredClone(
				source.graph.deployments['azure-gpt-test']
			);
			source.graph.deployments['azure-gpt-test-fast'].upstream.serviceTier = 'fast';
		});
		expect(buildCatalogs(fast).runtime.graph.deployments['azure-gpt-test-fast']).toBeDefined();

		const instant = changed((source) => {
			asAzure(source);
			const deployment = source.graph.deployments['azure-gpt-test'];
			deployment.upstream.deploymentType = 'instant';
			deployment.overrides = { dataHandling: { storageLocation: 'world', retentionDays: null } };
		});
		expect(buildCatalogs(instant).runtime.graph.deployments['azure-gpt-test']).toBeDefined();
	});

	describe('rejects contradictory Azure target structures', () => {
		testRejections([
			[
				'non-Anthropic model on the Anthropic route',
				(source: Source) => {
					asAzure(source);
					source.graph.routes['azure-anthropic-messages'] = {
						...source.graph.routes['azure-responses']
					};
					source.graph.deployments['azure-gpt-test'].routeIds = ['azure-anthropic-messages'];
				},
				'only Azure Anthropic-format models use the Azure Anthropic Messages route'
			],
			[
				'Anthropic model with a non-Anthropic format',
				(source: Source) => {
					asAzureClaude(source);
					source.graph.deployments['azure-gpt-test'].upstream.modelFormat = 'OpenAI';
					source.graph.deployments['azure-gpt-test'].upstream.hosting = 'azure';
				},
				'only Azure Anthropic-format models use the Azure Anthropic Messages route'
			],
			[
				'Anthropic model on another route',
				(source: Source) => {
					asAzureClaude(source);
					source.graph.routes['azure-responses'] = {
						...source.graph.routes['azure-anthropic-messages'],
						interfaces: ['responses']
					};
					source.graph.deployments['azure-gpt-test'].routeIds = ['azure-responses'];
				},
				'only Azure Anthropic-format models use the Azure Anthropic Messages route'
			],
			[
				'Azure US Data Zone with world handling',
				(source: Source) => {
					asAzure(source);
					source.graph.deployments['azure-gpt-test'].upstream.deploymentType =
						'data_zone_standard_us';
				},
				'Data Zone Standard must keep processing and storage in its declared location'
			],
			[
				'Azure Instant with standard handling',
				(source: Source) => {
					asAzure(source);
					source.graph.deployments['azure-gpt-test'].upstream.deploymentType = 'instant';
				},
				'Azure Instant and Flex previews must keep world storage and unknown retention'
			],
			[
				'Azure Flex with standard handling',
				(source: Source) => {
					asAzure(source);
					source.graph.deployments['azure-gpt-test'].upstream.serviceTier = 'flex';
				},
				'Azure Instant and Flex previews must keep world storage and unknown retention'
			],
			[
				'Anthropic US geography with world handling',
				asAnthropic,
				'processingLocation must match upstream inferenceGeo'
			],
			[
				'Anthropic US handling without a US geography',
				(source: Source) => {
					asAnthropic(source);
					const deployment = source.graph.deployments['anthropic-gpt-test'];
					deployment.upstream.inferenceGeo = 'global';
					deployment.overrides = { dataHandling: { processingLocation: 'US' } };
				},
				'processingLocation must match upstream inferenceGeo'
			],
			[
				'service tier on a model format without tiers',
				(source: Source) => {
					asAzure(source);
					source.graph.deployments['azure-gpt-test'].upstream.modelFormat = 'DeepSeek';
					source.graph.deployments['azure-gpt-test'].upstream.serviceTier = 'fast';
				},
				'Azure offers service tiers only for OpenAI-format models'
			]
		]);
	});

	describe('rejects a Fast deployment that cannot be billed at Standard', () => {
		function addFast(source: Source) {
			source.graph.deployments['openai-gpt-test-fast'] = {
				...structuredClone(source.graph.deployments['openai-gpt-test']),
				upstream: { model: 'gpt-test', serviceTier: 'fast' }
			};
		}
		testRejections([
			[
				'a Fast deployment without a Standard one',
				(source: Source) => {
					source.graph.deployments['openai-gpt-test'].upstream = {
						model: 'gpt-test',
						serviceTier: 'fast'
					};
				},
				'openai-gpt-test: Fast needs a Standard deployment on openai-responses'
			],
			[
				'several Standard deployments that differ only in the upstream model',
				(source: Source) => {
					addFast(source);
					source.graph.deployments['openai-gpt-test-2'] = {
						...structuredClone(source.graph.deployments['openai-gpt-test']),
						upstream: { model: 'gpt-test-2' }
					};
				},
				'openai-gpt-test-fast: Fast matches several Standard deployments on openai-responses'
			],
			[
				'a Standard deployment that retires first',
				(source: Source) => {
					addFast(source);
					Object.assign(source.graph.deployments['openai-gpt-test'], {
						retirementDate: '2099-01-01'
					});
				},
				'Fast needs a Standard deployment'
			]
		]);
	});

	test('records an omitted service tier as standard', () => {
		const built = buildCatalogs(sourceFixture());
		expect(built.runtime.graph.deployments['openai-gpt-test'].upstream.serviceTier).toBe(
			'standard'
		);
		expect(built.public.graph.deployments['openai-gpt-test'].upstream.serviceTier).toBe('standard');
	});

	test('allows fixed reasoning mode only on Responses-only routes', () => {
		const source = sourceFixture();
		source.graph.deployments['openai-gpt-test'].upstream.reasoningMode = 'pro';
		expect(buildCatalogs(source).runtime.graph.deployments['openai-gpt-test']).toBeDefined();

		expect(() =>
			buildCatalogs(
				changed((candidate) => {
					candidate.graph.routes['openai-responses'].interfaces = ['chat_completions', 'responses'];
					candidate.graph.deployments['openai-gpt-test'].upstream.reasoningMode = 'pro';
				})
			)
		).toThrow('fixed reasoning mode requires Responses-only routes');
	});

	test('allows fixed reasoning mode for an Azure-hosted OpenAI-author model', () => {
		const source = sourceFixture();
		asAzure(source);
		source.graph.deployments['azure-gpt-test'].upstream.reasoningMode = 'pro';
		expect(buildCatalogs(source).runtime.graph.deployments['azure-gpt-test']).toBeDefined();
	});

	test('rejects unsafe CLI flag combinations before touching output', async () => {
		await expect(main(['--unknown'])).rejects.toThrow('Unknown catalog build argument');
		await expect(main(['--clean', '--check'])).rejects.toThrow(
			'--clean cannot be combined with another catalog build argument'
		);
		await expect(main(['--check', '--validate-only'])).rejects.toThrow(
			'--check and --validate-only cannot be combined'
		);
	});
});

describe('route document formats', () => {
	const pdf = { extensions: ['.pdf'], mediaTypes: ['application/pdf'] };
	const documents = { extensions: ['.pdf', '.txt'], mediaTypes: ['application/pdf', 'text/plain'] };

	test('stay on each route and enter the chains of its deployments', () => {
		const source = sourceFixture();
		source.graph.routes['openai-responses'].documentFormats = documents;
		addSecondOpenAIRoute(source);
		source.graph.routes['openai-chat-completions'].documentFormats = pdf;
		source.graph.deployments['openai-gpt-test'].routeIds.push('openai-chat-completions');
		const original = buildCatalogs(source);
		for (const artifact of [original.runtime, original.public]) {
			expect(artifact.graph.routes['openai-responses'].documentFormats).toEqual(documents);
			expect(artifact.graph.routes['openai-chat-completions'].documentFormats).toEqual(pdf);
		}
		const deployment = original.runtime.graph.deployments['openai-gpt-test'];
		expect(Object.keys(deployment.routes)).toEqual(['openai-chat-completions', 'openai-responses']);
		expect(deployment.routes['openai-responses']).not.toHaveProperty('documentFormats');

		source.graph.routes['openai-responses'].documentFormats = pdf;
		const changedRoute = buildCatalogs(source).runtime.graph.deployments['openai-gpt-test'];
		expect(chainHash(changedRoute)).not.toBe(chainHash(deployment));
		expect(changedRoute.routes['openai-chat-completions'].chainHash).toBe(
			deployment.routes['openai-chat-completions'].chainHash
		);
	});

	test('keep provider-processed PDFs for a text-only model', () => {
		const source = sourceFixture();
		source.graph.routes['openai-responses'].documentFormats = documents;
		source.graph.models['gpt-test'].inputModalities = ['text'];
		const { runtime } = buildCatalogs(source);
		expect(runtime.graph.routes['openai-responses'].documentFormats).toEqual(documents);
		expect(
			runtime.graph.deployments['openai-gpt-test'].routes['openai-responses'].inputModalities
		).toEqual(['text']);
	});

	test.each([
		{ extensions: ['pdf'], mediaTypes: ['application/pdf'] },
		{ extensions: ['.PDF'], mediaTypes: ['application/pdf'] },
		{ extensions: ['.pdf'], mediaTypes: ['application/*'] },
		{ extensions: ['.pdf'], mediaTypes: ['application/pdf', 'application/pdf'] },
		{ extensions: ['.txt', '.pdf'], mediaTypes: ['application/pdf'] },
		{ extensions: ['.pdf'], mediaTypes: [] },
		{ extensions: ['.pdf'], mediaTypes: ['application/pdf'], unknown: true }
	])('rejects ambiguous format facts %j', (formats) => {
		const source = sourceFixture();
		source.graph.routes['openai-responses'].documentFormats = formats;
		expect(() => buildCatalogs(source)).toThrow(/documentFormats/);
	});
});
