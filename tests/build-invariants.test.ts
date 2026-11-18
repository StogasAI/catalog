import { describe, expect, test } from 'bun:test';
import { canonicalJson } from '../source/scripts/canonical-json.mjs';
import { buildCatalog, catalogFiles, main } from '../source/scripts/build.mjs';
import { assembleCatalog, partsInEffect } from '../source/scripts/catalog-files.mjs';
import { everyStateCatalogChains } from '../source/scripts/resolved-chains.mjs';
import { countriesIn, locationWithin, placeIndex } from '../source/scripts/locations.mjs';
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
	toolChoice: true,
	toolResultAttachments: true
};

const sampling = {
	temperature: true,
	topP: true,
	topK: false,
	frequencyPenalty: true,
	presencePenalty: true,
	repetitionPenalty: false,
	seed: true,
	logitBias: true
};

// Web search as OpenAI's Responses API offers it, with every call meter of its wire.
function openaiWebSearch(price: string) {
	return {
		tool: 'web_search',
		pricing: {
			openai_responses_web_search_calls: { per_1k_calls: price },
			openai_responses_web_search_preview_calls: { per_1k_calls: price },
			openai_responses_web_search_preview_non_reasoning_calls: { per_1k_calls: price }
		}
	} as Record<string, unknown>;
}

function sourceFixture() {
	return {
		locations: {
			world: { name: 'World', kind: 'world' },
			europe: { name: 'Europe', kind: 'continent', countries: ['CH', 'CY', 'DE', 'FR'] },
			eu: { name: 'European Union', kind: 'union', countries: ['CY', 'DE', 'FR'] },
			DE: { name: 'Germany', kind: 'country' },
			'north-america': { name: 'North America', kind: 'continent', countries: ['CA', 'US'] },
			US: { name: 'United States', kind: 'country' }
		} as Record<
			string,
			{
				name: string;
				kind?: string;
				countries?: string[];
				parentIds?: string[];
			}
		>,
		companies: {
			openai: { name: 'OpenAI', headquarteredCountry: 'US' }
		} as Record<string, { name: string; headquarteredCountry: string }>,
		graph: {
			authors: {
				openai: { name: 'OpenAI', companyId: 'openai' }
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
					stogasByok: true as true | undefined,
					stogasManaged: undefined as true | undefined,
					companyId: 'openai',
					accountLocations: ['DE', 'US'] as string[] | undefined,
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
					interfaces: ['responses'],
					inputModalities: ['text', 'image'],
					capabilities: structuredClone(capabilities),
					sampling: structuredClone(sampling),
					hosting: undefined as string | undefined,
					documentFormats: undefined as { extensions: string[]; mediaTypes: string[] } | undefined,
					dataHandling: { endToEndEncrypted: false },
					hostedTools: [] as Array<Record<string, unknown>>
				}
			},
			deployments: {
				'openai-gpt-test': {
					modelId: 'gpt-test',
					routeIds: ['openai-responses'],
					hosting: undefined as string | undefined,
					upstream: { model: 'gpt-test' } as Record<string, unknown>,
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
		expect(() => buildCatalog(changed(mutate))).toThrow(message);
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
		interfaces: ['chat_completions'],
		inputModalities: ['text', 'image'],
		capabilities: structuredClone(capabilities),
		sampling: structuredClone(sampling),
		dataHandling: { endToEndEncrypted: false }
	};
}

/** The fixture's provider under another ID, as the offering of another company. */
function asProvider(source: Source, providerId: string, companyId: string, name: string) {
	source.companies[companyId] = { name, headquarteredCountry: 'US' };
	source.graph.providers[providerId] = { ...source.graph.providers.openai, companyId };
	delete source.graph.providers.openai;
}

function asAzure(source: Source) {
	asProvider(source, 'azure', 'microsoft', 'Microsoft');
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
			deploymentType: 'global_standard'
		}
	};
	delete source.graph.deployments['openai-gpt-test'];
}

function asAnthropic(source: Source) {
	asProvider(source, 'anthropic', 'anthropic', 'Anthropic');
	source.graph.routes['anthropic-messages'] = {
		...source.graph.routes['openai-responses'],
		providerId: 'anthropic'
	};
	delete source.graph.routes['openai-responses'];
	source.graph.deployments['anthropic-gpt-test-us'] = {
		...source.graph.deployments['openai-gpt-test'],
		routeIds: ['anthropic-messages'],
		upstream: { model: 'gpt-test', inferenceGeo: 'us' }
	};
	delete source.graph.deployments['openai-gpt-test'];
}

function asAzureClaude(source: Source) {
	asAzure(source);
	source.companies.anthropic = { name: 'Anthropic', headquarteredCountry: 'US' };
	source.graph.authors.anthropic = { name: 'Anthropic', companyId: 'anthropic' };
	source.graph.models['gpt-test'].authorId = 'anthropic';
	source.graph.routes['azure-anthropic-messages'] = {
		...source.graph.routes['azure-responses'],
		interfaces: ['chat_completions', 'responses']
	};
	delete source.graph.routes['azure-responses'];
	source.graph.deployments['azure-gpt-test'].routeIds = ['azure-anthropic-messages'];
	source.graph.deployments['azure-gpt-test'].upstream.modelFormat = 'Anthropic';
}

describe('catalog source compiler invariants', () => {
	test('rejects invalid IDs in every collection before interpreting their node fields', () => {
		for (const kind of ['authors', 'groups', 'models', 'providers', 'routes', 'deployments']) {
			for (const id of [
				'Uppercase',
				'has/slash',
				'kind:id',
				'__proto__',
				'trailing\n',
				'a: injected',
				// The value of a fact that no source states.
				'unknown'
			]) {
				const source = sourceFixture();
				source.graph[kind] = { ...source.graph[kind], [id]: { unvalidated: true } };
				expect(() => buildCatalog(source)).toThrow(`${kind}: invalid node ID`);
			}
		}
	});

	test('compiles nested groups with shared ancestors without changing execution identity', () => {
		const source = sourceFixture();
		const original = buildCatalog(source);
		source.graph.groups = {
			root: { authorId: 'openai', name: 'Root' },
			left: { authorId: 'openai', name: 'Left', parentIds: ['root'] },
			right: { authorId: 'openai', name: 'Right', parentIds: ['root'] },
			leaf: { authorId: 'openai', name: 'Leaf', parentIds: ['right', 'left'] }
		};
		source.graph.models['gpt-test'].groupIds = ['leaf'];
		const grouped = buildCatalog(source);
		expect(grouped.graph.groups.leaf.parentIds).toEqual(['left', 'right']);
		expect(grouped.graph.models['gpt-test'].groupIds).toEqual(['leaf']);
		expect(chainHash(grouped.graph.deployments['openai-gpt-test'])).toBe(
			chainHash(original.graph.deployments['openai-gpt-test'])
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
					value.graph.authors.other = { name: 'Other', companyId: 'openai' };
					value.graph.groups.leaf.authorId = 'other';
				},
				'another author'
			]
		] as const) {
			const invalid = structuredClone(source);
			mutate(invalid);
			expect(() => buildCatalog(invalid)).toThrow(message);
		}
	});

	test.each(['0', '0.001', '0.042', '0.000000000000000000000000000000000001', '1000000000000'])(
		'preserves exact rate %s USD',
		(rate) => {
			const source = sourceFixture();
			source.graph.deployments['openai-gpt-test'].pricing.output_tokens.per_mill_tokens = rate;
			expect(
				buildCatalog(source).graph.deployments['openai-gpt-test'].pricing.output_tokens
					.per_mill_tokens
			).toBe(rate);
		}
	);
	test('materializes one minimal graph without provider defaults', () => {
		const catalogs = buildCatalog(sourceFixture());
		expect(catalogs.graph.deployments['openai-gpt-test']).toMatchObject({
			contextWindowTokens: 1000,
			maxOutputTokens: 200,
			routes: { 'openai-responses': { reasoningEfforts: ['low', 'high'] } }
		});
		expect(catalogs.graph.providers.openai).toEqual({
			accountLocations: ['DE', 'US'],
			aliases: [],
			companyId: 'openai',
			headquarteredCountry: 'US',
			name: 'OpenAI'
		});
	});

	test('lists the notes of every kind of node with the node that states each', () => {
		const source = sourceFixture();
		const text = 'Readers need this sentence.';
		const { graph } = source as unknown as {
			graph: Record<string, Record<string, { notes?: unknown }>>;
		};
		const kinds = ['authors', 'models', 'providers', 'routes', 'deployments'];
		for (const kind of kinds) for (const node of Object.values(graph[kind])) node.notes = text;
		const compiled = buildCatalog(source).graph as unknown as typeof graph;
		const plain = buildCatalog(sourceFixture()).graph as unknown as typeof graph;
		const note = (kind: string) => ({ kind, id: Object.keys(compiled[`${kind}s`])[0], text });
		// A route also holds its provider's notes, and a deployment those of its routes and its model.
		expect(Object.values(compiled.authors)[0].notes).toEqual([note('author')]);
		expect(Object.values(compiled.models)[0].notes).toEqual([note('model')]);
		expect(Object.values(compiled.providers)[0].notes).toEqual([note('provider')]);
		expect(Object.values(compiled.routes)[0].notes).toEqual([note('provider'), note('route')]);
		expect(Object.values(compiled.deployments)[0].notes).toEqual([
			note('provider'),
			note('route'),
			note('model'),
			note('deployment')
		]);
		for (const kind of kinds)
			expect(Object.values(plain[kind]).map((node) => node.notes)).toEqual([undefined]);
	});

	test('accepts aliases that move a word across the version, add or remove the snapshot date, or name a group', () => {
		const source = sourceFixture();
		const { models } = source.graph;
		Object.assign(source.graph, { groups: { gpt: { authorId: 'openai', name: 'GPT' } } });
		Object.assign(models['gpt-test'], { aliases: ['gpt'], groupIds: ['gpt'] });
		models['gpt-opus-4-5'] = {
			...models['gpt-test'],
			name: 'GPT Opus 4.5',
			aliases: ['gpt-4.5-opus', 'gpt-opus-4-5-20260102'],
			groupIds: [],
			snapshot: '2026-01-02'
		};
		models['gpt-snap-2026-01-03'] = {
			...models['gpt-test'],
			name: 'GPT Snap',
			aliases: ['gpt-snap'],
			groupIds: [],
			snapshot: '2026-01-03'
		};
		const built = buildCatalog(source).graph;
		expect(built.models['gpt-test'].aliases).toEqual(['gpt']);
		expect(built.models['gpt-opus-4-5'].aliases).toEqual(['gpt-4.5-opus', 'gpt-opus-4-5-20260102']);
		expect(built.models['gpt-snap-2026-01-03'].aliases).toEqual(['gpt-snap']);
		// The model that the author's API serves under a group's ID shares it as an alias.
		expect(Object.keys(built.groups)).toEqual(['gpt']);
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
		expect(canonicalJson(buildCatalog(reversed))).toBe(canonicalJson(buildCatalog(source)));
	});

	test('derives the places that contain each place from the countries that regions list', () => {
		const source = sourceFixture();
		source.locations['US-CA'] = { name: 'California', kind: 'subdivision' };
		source.locations.CY = { name: 'Cyprus', kind: 'country' };
		source.locations.AQ = { name: 'Antarctica', kind: 'country' };
		source.locations.asia = {
			name: 'Asia',
			kind: 'continent',
			countries: ['CY', 'JP']
		};
		source.graph.providers.openai.accountLocations = ['AQ', 'CY', 'DE'];
		Object.assign(source.graph.providers.openai.dataHandling, {
			processingLocation: 'eu',
			storageLocation: 'US-CA'
		});
		const { locations } = buildCatalog(source);
		expect(Object.keys(locations)).toEqual(Object.keys(locations).sort());
		expect(locations.world).toEqual({ name: 'World', kind: 'world', parentIds: [] });
		expect(locations.asia).toEqual({
			name: 'Asia',
			kind: 'continent',
			countries: ['CY', 'JP'],
			parentIds: ['world']
		});
		// The EU lists Cyprus and lies in Europe, which also lists it, so Europe is no parent.
		expect(locations.CY).toEqual({ name: 'Cyprus', kind: 'country', parentIds: ['asia', 'eu'] });
		expect(locations.eu!.parentIds).toEqual(['europe']);
		expect(locations.europe!.parentIds).toEqual(['world']);
		// A country that no region lists lies in world, and a subdivision in its country.
		expect(locations.AQ).toEqual({ name: 'Antarctica', kind: 'country', parentIds: ['world'] });
		expect(locations['US-CA']).toEqual({
			name: 'California',
			kind: 'subdivision',
			parentIds: ['US']
		});
	});

	test('keeps a region inside another only when the other lists all of its countries', () => {
		const source = sourceFixture();
		// The EU holds Germany but not Switzerland, so a region of both lies only in Europe.
		source.locations.alps = { name: 'Alps', kind: 'region', countries: ['CH', 'DE'] };
		source.graph.providers.openai.dataHandling.processingLocation = 'alps';
		const { locations } = buildCatalog(source);
		expect(locations.alps!.parentIds).toEqual(['europe']);
		expect(locations.DE!.parentIds).toEqual(['alps', 'eu']);
	});

	test('reads a place index that a catalog lists, and rejects one that cannot be', () => {
		const places = placeIndex(buildCatalog(sourceFixture()).locations);
		expect(places.countries.get('eu')).toEqual(['CY', 'DE', 'FR']);
		expect(countriesIn(places, 'eu')).toEqual(['CY', 'DE', 'FR']);
		expect(countriesIn(places, 'DE')).toEqual(['DE']);
		// A country that the catalog does not list lies in each region that lists it.
		expect(locationWithin(places, 'FR')).toEqual(['FR', 'eu', 'europe', 'world']);
		expect(locationWithin(places, 'JP')).toEqual(['JP', 'world']);
		expect(locationWithin(places, 'unknown')).toEqual(['unknown']);
		// Nothing kept lies within every place.
		expect(locationWithin(places, 'none')).toEqual([...places.within.keys(), 'none'].sort());
		const place = (parentIds: string[]) => ({ name: 'Place', parentIds });
		for (const [locations, message] of [
			[{ world: place(['eu']), eu: place(['world']) }, 'Locations must have world'],
			[{ world: place([]), eu: place([]) }, 'Location eu lies in no place'],
			[{ world: place([]), eu: place(['emea']) }, 'Location eu lies in unknown place emea'],
			[{ world: place([]), eu: place(['world', 'world']) }, 'Location eu repeats a parent'],
			[{ world: place([]), eu: place(['europe']), europe: place(['eu']) }, 'lies in itself']
		] as const)
			expect(() => placeIndex(locations), message).toThrow(message);
	});

	describe('rejects invalid locations and places that they do not list', () => {
		testRejections([
			[
				'no world',
				(source: Source) => {
					delete source.locations.world;
				},
				'Locations must have world'
			],
			[
				'listed parents',
				(source: Source) => (source.locations.DE.parentIds = ['eu']),
				'Location DE: the places that contain it follow from the countries that regions list, so it lists no parentIds'
			],
			...(
				[
					['region without countries', (source: Source) => delete source.locations.eu.countries],
					['country with countries', (source: Source) => (source.locations.DE.countries = ['DE'])],
					['world with countries', (source: Source) => (source.locations.world.countries = ['DE'])]
				] as const
			).map(
				([name, mutate]) =>
					[
						name,
						mutate,
						/a continent, region or union lists its countries, and no other place does/
					] as const
			),
			...(
				[
					['no countries', []],
					['countries out of order', ['DE', 'CY', 'FR']],
					['a country listed twice', ['CY', 'DE', 'DE', 'FR']],
					['a code that is not a country', ['CY', 'DE', 'FRA']],
					['a lowercase code', ['CY', 'de', 'FR']]
				] as const
			).map(
				([name, countries]) =>
					[
						name,
						(source: Source) => (source.locations.eu.countries = [...countries]),
						'Location eu: countries must list ISO 3166-1 codes in order, once each'
					] as const
			),
			[
				'regions that list the same countries',
				(source: Source) =>
					(source.locations.emea = { name: 'EMEA', kind: 'region', countries: ['CY', 'DE', 'FR'] }),
				'Locations emea and eu list the same countries'
			],
			[
				'IDs that differ only in case',
				(source: Source) => (source.locations.EU = { name: 'EU', kind: 'country' }),
				'Locations EU and eu differ only in case'
			],
			[
				'subdivision of a country that locations does not list',
				(source: Source) => (source.locations['FR-75'] = { name: 'Paris', kind: 'subdivision' }),
				'Location FR-75 lies in unknown place FR'
			],
			...['unknown', 'none', 'Europe', 'e_u', 'DEU'].map(
				(id) =>
					[
						`invalid ID ${id}`,
						(source: Source) =>
							(source.locations[id] = { name: id, kind: 'region', countries: ['DE'] }),
						`Location ${JSON.stringify(id)} has an invalid ID`
					] as const
			),
			...(
				[
					['DE', 'region'],
					['eu', 'country'],
					['world', 'continent'],
					['europe', 'world'],
					['US', undefined]
				] as const
			).map(
				([id, kind]) =>
					[
						`${id} as a ${kind}`,
						(source: Source) => (source.locations[id]!.kind = kind as string),
						`Location ${id}: kind ${kind} does not fit its ID`
					] as const
			),
			[
				'place that no record names',
				(source: Source) => (source.locations.FR = { name: 'France', kind: 'country' }),
				'Location FR: no record names it or a place inside it, so remove it'
			],
			[
				'account location that locations does not list',
				(source: Source) => (source.graph.providers.openai.accountLocations = ['DE', 'FR', 'US']),
				'openai: accountLocations must list places that locations lists, in order, once each'
			],
			[
				'account locations out of order',
				(source: Source) => (source.graph.providers.openai.accountLocations = ['US', 'DE']),
				'openai: accountLocations must list places that locations lists, in order, once each'
			],
			[
				'account location listed twice',
				(source: Source) => (source.graph.providers.openai.accountLocations = ['DE', 'DE', 'US']),
				'openai: accountLocations must list places that locations lists, in order, once each'
			],
			[
				'unlisted processing location',
				(source: Source) => (source.graph.providers.openai.dataHandling.processingLocation = 'FR'),
				'dataHandling names a place that locations does not list'
			],
			[
				'none as a processing location',
				(source: Source) =>
					(source.graph.providers.openai.dataHandling.processingLocation = 'none'),
				'dataHandling names a place that locations does not list'
			],
			[
				'unlisted storage location',
				(source: Source) => (source.graph.providers.openai.dataHandling.storageLocation = 'FR'),
				'dataHandling names a place that locations does not list'
			],
			[
				'unlisted headquarters',
				(source: Source) => Object.assign(source.companies.openai, { headquarteredCountry: 'FR' }),
				'headquarteredCountry names a country that locations does not list'
			],
			[
				'region as headquarters',
				(source: Source) => Object.assign(source.companies.openai, { headquarteredCountry: 'eu' }),
				'headquarteredCountry names a country that locations does not list'
			]
		]);
	});

	describe('rejects invalid references', () => {
		testRejections([
			[
				'unknown author',
				(source: Source) => (source.graph.models['gpt-test'].authorId = 'missing'),
				'missing referenced node missing'
			],
			...Object.entries({
				author: (source: Source) => (source.graph.models['gpt-test'].authorId = 'constructor'),
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
			])
		]);
	});

	describe('rejects invalid model dates, limits, modalities, and reasoning', () => {
		testRejections([
			[
				'impossible release date',
				(source: Source) => (source.graph.models['gpt-test'].releaseDate = '2026-02-30'),
				'releaseDate is invalid'
			],
			[
				'a weights link on a closed model',
				(source: Source) =>
					Object.assign(source.graph.models['gpt-test'], {
						weightsUrl: 'https://huggingface.co/openai/gpt-test'
					}),
				'state weightsUrl exactly when openWeights is true'
			],
			[
				'an open model without a weights link',
				(source: Source) => Object.assign(source.graph.models['gpt-test'], { openWeights: true }),
				'state weightsUrl exactly when openWeights is true'
			],
			[
				'a model that succeeds itself',
				(source: Source) =>
					Object.assign(source.graph.models['gpt-test'], { succeeds: 'gpt-test' }),
				'succeeds must name a model of the same author that was released earlier'
			],
			[
				'a model that succeeds a missing model',
				(source: Source) =>
					Object.assign(source.graph.models['gpt-test'], { succeeds: 'gpt-none' }),
				'succeeds must name a model of the same author that was released earlier'
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
		const catalogs = buildCatalog(source);
		expect(catalogs.graph.models['gpt-test']).toMatchObject({
			snapshot: '2026-01-02',
			reasoningMaxTokens: { minimum: 1, maximum: 199 }
		});

		const deploymentBoundary = sourceFixture();
		Object.assign(deploymentBoundary.graph.deployments['openai-gpt-test'], {
			retirementDate: '2026-01-02'
		});
		expect(
			buildCatalog(deploymentBoundary).graph.deployments['openai-gpt-test'].retirementDate
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
		],
		[
			'rejects an impossible route retirement date',
			(source) => {
				Object.assign(source.graph.routes['openai-responses'], { retirementDate: '2026-02-30' });
			},
			'openai-responses: retirementDate is invalid'
		],
		[
			'rejects an impossible provider retirement date',
			(source) => {
				Object.assign(source.graph.providers.openai, { retirementDate: '2026-02-30' });
			},
			'openai: retirementDate is invalid'
		],
		[
			'rejects a provider retirement that ends a deployment before its model is released',
			(source) => {
				Object.assign(source.graph.providers.openai, { retirementDate: '2026-01-01' });
			},
			'retirementDate precedes model releaseDate'
		]
	]);

	test('a route or a provider retires on its own date, and so does each deployment it ends', () => {
		const source = sourceFixture();
		addSecondOpenAIRoute(source);
		const { deployments, models, providers, routes } = source.graph;
		models['gpt-only'] = { ...models['gpt-test'], name: 'GPT Only', aliases: [] };
		deployments['openai-gpt-test'].routeIds = ['openai-chat-completions', 'openai-responses'];
		deployments['openai-gpt-only'] = {
			...structuredClone(deployments['openai-gpt-test']),
			modelId: 'gpt-only',
			routeIds: ['openai-chat-completions'],
			upstream: { model: 'gpt-only' }
		};
		Object.assign(routes['openai-chat-completions'], { retirementDate: '2026-08-01' });
		let catalog = buildCatalog(source);
		expect(catalog.graph.routes['openai-chat-completions'].retirementDate).toBe('2026-08-01');
		expect(catalog.graph.routes['openai-responses'].retirementDate).toBeNull();
		// The other route still serves the first deployment.
		expect(catalog.graph.deployments['openai-gpt-test'].retirementDate).toBeNull();
		expect(catalog.graph.deployments['openai-gpt-only'].retirementDate).toBe('2026-08-01');
		let root = JSON.parse(catalogFiles(catalog).rootJson);
		expect(root.summaries.models['gpt-only'].retirementDate).toBe('2026-08-01');
		expect(root.summaries.routes['openai-chat-completions'].retirementDate).toBe('2026-08-01');
		expect(root.summaries.providers.openai.retirementDate).toBeNull();

		Object.assign(providers.openai, { retirementDate: '2026-07-01' });
		catalog = buildCatalog(source);
		expect(catalog.graph.routes['openai-chat-completions'].retirementDate).toBe('2026-07-01');
		expect(catalog.graph.routes['openai-responses'].retirementDate).toBe('2026-07-01');
		expect(catalog.graph.deployments['openai-gpt-test'].retirementDate).toBe('2026-07-01');
		// The provider's routes carry its date, so its record, which the root holds, does not.
		expect(catalog.graph.providers.openai).not.toHaveProperty('retirementDate');
		const files = catalogFiles(catalog);
		root = JSON.parse(files.rootJson);
		expect(root.summaries.providers.openai.retirementDate).toBe('2026-07-01');
		expect(root.summaries.models['gpt-test'].retirementDate).toBe('2026-07-01');
		const parts = root.parts.map(({ sha256 }: { sha256: string }) =>
			JSON.parse(files.parts.get(`${sha256}.json`)!)
		);
		expect(canonicalJson(assembleCatalog(root, parts).graph)).toBe(canonicalJson(catalog.graph));
	});

	test('lists what Stogas does not serve, with its reason, in parts that the gateway skips', () => {
		const source = sourceFixture();
		addSecondOpenAIRoute(source);
		const { authors, deployments, models, providers, routes } = source.graph;
		models['gpt-batch'] = { ...models['gpt-test'], name: 'GPT Batch', aliases: [] };
		deployments['openai-gpt-batch'] = {
			...structuredClone(deployments['openai-gpt-test']),
			modelId: 'gpt-batch',
			routeIds: ['openai-chat-completions'],
			upstream: { model: 'gpt-batch' }
		};
		const batch = 'The gateway has no batch API.';
		Object.assign(routes['openai-chat-completions'], { stogasByok: false, notes: batch });
		let catalog = buildCatalog(source);
		const serving = (record: { stogasByok: boolean; stogasManaged: boolean }) => [
			record.stogasByok,
			record.stogasManaged
		];
		// The route's deployments go unserved with it and carry its note; the other route and its
		// deployment stay served with a customer's credential, the only way that the provider offers.
		const batchNote = { kind: 'route', id: 'openai-chat-completions', text: batch };
		expect(serving(catalog.graph.routes['openai-chat-completions'])).toEqual([false, false]);
		expect(serving(catalog.graph.deployments['openai-gpt-batch'])).toEqual([false, false]);
		expect(catalog.graph.deployments['openai-gpt-batch'].notes).toEqual([batchNote]);
		expect(serving(catalog.graph.routes['openai-responses'])).toEqual([true, false]);
		expect(serving(catalog.graph.deployments['openai-gpt-test'])).toEqual([true, false]);
		expect(catalog.graph.deployments['openai-gpt-test'].notes).toBeUndefined();
		let files = catalogFiles(catalog);
		let root = JSON.parse(files.rootJson);
		// A model goes unserved with its deployments, and a provider with its routes.
		expect(serving(root.summaries.models['gpt-batch'])).toEqual([false, false]);
		expect(serving(root.summaries.models['gpt-test'])).toEqual([true, false]);
		expect(serving(root.summaries.providers.openai)).toEqual([true, false]);
		expect(serving(root.summaries.deployments['openai-gpt-batch'])).toEqual([false, false]);
		// Unserved records follow the others in parts of their own, which readers skip by default.
		expect(root.parts.map(serving)).toEqual([
			[true, false],
			[false, false]
		]);
		expect(root.summaries.deployments['openai-gpt-batch'].part).toBe(1);
		expect(root.summaries.models['gpt-batch'].part).toBe(1);
		expect(root.summaries.routes['openai-chat-completions'].part).toBe(1);
		expect(partsInEffect(root)).toEqual([0]);
		expect(partsInEffect(root, Date.now(), { unserved: true })).toEqual([0, 1]);
		const read = (positions: number[]) =>
			root.parts.map(({ sha256 }: { sha256: string }, index: number) =>
				positions.includes(index) ? JSON.parse(files.parts.get(`${sha256}.json`)!) : null
			);
		expect(canonicalJson(assembleCatalog(root, read([0, 1])).graph)).toBe(
			canonicalJson(catalog.graph)
		);
		// The served records reach no unserved one.
		const served = assembleCatalog(root, read([0])).graph;
		expect(Object.keys(served.deployments)).toEqual(['openai-gpt-test']);
		expect(Object.keys(served.routes)).toEqual(['openai-responses']);

		// With its own account too, Stogas serves the other route in both ways and the batch route in
		// that one, until a deployment withdraws it.
		providers.openai.stogasManaged = true;
		catalog = buildCatalog(source);
		expect(serving(catalog.graph.routes['openai-chat-completions'])).toEqual([false, true]);
		expect(serving(catalog.graph.deployments['openai-gpt-test'])).toEqual([true, true]);
		Object.assign(deployments['openai-gpt-batch'], { stogasManaged: false });
		catalog = buildCatalog(source);
		expect(serving(catalog.graph.deployments['openai-gpt-batch'])).toEqual([false, false]);
		root = JSON.parse(catalogFiles(catalog).rootJson);
		expect(serving(root.summaries.providers.openai)).toEqual([true, true]);
		expect(root.parts.map(serving)).toEqual([
			[true, true],
			[false, false]
		]);
		delete deployments['openai-gpt-batch'].stogasManaged;
		providers.openai.stogasManaged = undefined;

		// A provider that Stogas does not serve takes each route and deployment with it, which
		// carry its note. Its record, which the root holds whole, says so only in its summary.
		const cloud = 'Stogas has no account in this cloud.';
		delete routes['openai-chat-completions'].stogasByok;
		Object.assign(providers.openai, { stogasByok: undefined, notes: cloud });
		catalog = buildCatalog(source);
		const cloudNote = { kind: 'provider', id: 'openai', text: cloud };
		expect(serving(catalog.graph.routes['openai-responses'])).toEqual([false, false]);
		expect(catalog.graph.routes['openai-chat-completions'].notes).toEqual([cloudNote, batchNote]);
		expect(serving(catalog.graph.deployments['openai-gpt-test'])).toEqual([false, false]);
		expect(catalog.graph.deployments['openai-gpt-test'].notes).toEqual([cloudNote]);
		expect(catalog.graph.providers.openai).not.toHaveProperty('stogasByok');
		files = catalogFiles(catalog);
		root = JSON.parse(files.rootJson);
		expect(serving(root.summaries.providers.openai)).toEqual([false, false]);
		expect(serving(root.summaries.authors.openai)).toEqual([false, false]);
		expect(root.parts.every((part: { stogasByok: boolean }) => !part.stogasByok)).toBe(true);
		expect(partsInEffect(root)).toEqual([]);
		expect(authors.openai).not.toHaveProperty('stogasByok');
	});

	testRejections([
		[
			'rejects a deployment on routes that Stogas serves and on one that it does not',
			(source) => {
				addSecondOpenAIRoute(source);
				source.graph.deployments['openai-gpt-test'].routeIds = [
					'openai-chat-completions',
					'openai-responses'
				];
				Object.assign(source.graph.routes['openai-chat-completions'], {
					stogasByok: false,
					notes: 'The gateway has no batch API.'
				});
			},
			'openai-gpt-test: split the routes that offer stogasByok from the others'
		],
		[
			'rejects a route that withdraws a way that its provider does not offer',
			(source) => {
				Object.assign(source.graph.routes['openai-responses'], { stogasManaged: false });
			},
			'openai-responses: stogasManaged is false already'
		],
		[
			'rejects a batch route that withdraws a way of serving, which it never offers',
			(source) => {
				Object.assign(source.graph.routes['openai-responses'], { batch: true, stogasByok: false });
			},
			'openai-responses: stogasByok is false already'
		],
		[
			'rejects a deployment that withdraws a way that its routes do not offer',
			(source) => {
				Object.assign(source.graph.routes['openai-responses'], { stogasByok: false });
				Object.assign(source.graph.deployments['openai-gpt-test'], { stogasByok: false });
			},
			'openai-gpt-test: stogasByok is false already'
		],
		[
			'rejects a deployment on a batch route and on another',
			(source) => {
				addSecondOpenAIRoute(source);
				source.graph.deployments['openai-gpt-test'].routeIds = [
					'openai-chat-completions',
					'openai-responses'
				];
				Object.assign(source.graph.routes['openai-chat-completions'], { batch: true });
			},
			'openai-gpt-test: split the batch routes from the others'
		],
		[
			'rejects a service tier on a batch deployment',
			(source) => {
				Object.assign(source.graph.routes['openai-responses'], { batch: true });
				Object.assign(source.graph.deployments['openai-gpt-test'].upstream, {
					serviceTier: 'flex'
				});
			},
			'openai-gpt-test: a batch deployment names no service tier'
		],
		[
			'rejects a period that changes whether Stogas serves a record',
			(source) =>
				setPeriods(source.graph.deployments['openai-gpt-test'], [
					{
						name: 'Test',
						start: '2026-11-01T00:00:00Z',
						set: { stogasByok: false }
					}
				]),
			'cannot change stogasByok'
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
		const catalogs = buildCatalog(source);
		const base = buildCatalog(sourceFixture());
		expect(catalogs.graph).toEqual(base.graph);
		expect(base.schedule).toEqual([]);

		const [promotion, limited, promotionAgain, raised] = catalogs.schedule;
		expect(catalogs.schedule.map(({ start }) => start)).toEqual([
			'2026-11-01T00:00:00Z',
			'2026-11-15T00:00:00Z',
			'2026-11-20T00:00:00Z',
			'2026-12-01T00:00:00Z'
		]);
		const baseDeployment = base.graph.deployments['openai-gpt-test'];
		expect(Object.keys(promotion.graph)).toEqual(['deployments']);
		const route = (deployment: { routes: Record<string, Record<string, unknown>> }) =>
			deployment.routes['openai-responses'];
		expect(promotion.graph.deployments['openai-gpt-test'].pricing).toEqual({
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
			pricing: { output_tokens: { per_mill_tokens: '1' } },
			routes: { 'openai-responses': { reasoningEfforts: [] } }
		});
		expect(promotionAgain.graph).toEqual(promotion.graph);
		expect(raised.graph.deployments['openai-gpt-test'].pricing).toEqual({
			input_tokens: { per_mill_tokens: '0.5' },
			output_tokens: { per_mill_tokens: '2' }
		});
		// The promotion changes the price and so the chain, and nothing else.
		const promoted = promotion.graph.deployments['openai-gpt-test'];
		expect({
			...promoted,
			pricing: baseDeployment.pricing,
			routes: {
				'openai-responses': { ...route(promoted), chainHash: route(baseDeployment).chainHash }
			}
		}).toEqual(baseDeployment);

		expect(catalogs.periods).toEqual([
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
		expect(base.periods).toEqual([]);

		// History holds each chain that a request could log, once.
		expect([...everyStateCatalogChains(catalogs)].map((entry) => entry.hash)).toEqual([
			chainHash(baseDeployment),
			chainHash(promotion.graph.deployments['openai-gpt-test']),
			chainHash(limited.graph.deployments['openai-gpt-test']),
			chainHash(raised.graph.deployments['openai-gpt-test'])
		]);
		const altered = structuredClone(catalogs);
		altered.schedule[1].graph.deployments['openai-gpt-test'].routes['openai-responses'].chainHash =
			chainHash(baseDeployment);
		expect(() => [...everyStateCatalogChains(altered)]).toThrow(
			'Compiled catalog chain differs from its history.'
		);

		const at = (time: string) => catalogAt(catalogs, new Date(time));
		expect(at('2026-10-31T23:59:59Z')).toEqual(base.graph);
		expect(at('2026-11-01T00:00:00Z').deployments['openai-gpt-test']).toEqual(
			promotion.graph.deployments['openai-gpt-test']
		);
		expect(at('2026-11-19T23:59:59Z').models['gpt-test'].maxOutputTokens).toBe(100);
		expect(at('2027-01-01T00:00:00Z').deployments['openai-gpt-test'].pricing).toMatchObject({
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
		const catalog = buildCatalog(source);
		expect(catalog.schedule).toHaveLength(2);
		expect(catalog.schedule[0].graph.authors.openai.name).toBe('OpenAI Labs');
		// The author is in the chain of each deployment of its models, so their hashes change too.
		expect(Object.keys(catalog.schedule[0].graph.deployments)).toEqual(['openai-gpt-test']);
		expect(catalog.schedule[1]).toEqual({ start: '2026-11-02T00:00:00Z', graph: {} });
		// Only the author's summary differs, and the root keeps every start.
		expect(
			JSON.parse(catalogFiles(catalog).rootJson).schedule.map(
				({ summaries }: { summaries: object }) => Object.keys(summaries)
			)
		).toEqual([['authors'], []]);
	});

	test('keeps retired records, with the dates by which readers leave them out', () => {
		const source = sourceFixture();
		const deployment = source.graph.deployments['openai-gpt-test'];
		const { models, deployments } = source.graph;
		models['gpt-other'] = { ...models['gpt-test'], name: 'GPT Other', aliases: [] };
		models['gpt-listed'] = { ...models['gpt-test'], name: 'GPT Listed' };
		deployments['openai-gpt-test-flex'] = {
			...structuredClone(deployment),
			upstream: { model: 'gpt-test', serviceTier: 'flex' },
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
		const catalog = buildCatalog(source);
		expect(Object.keys(catalog.graph.deployments).sort()).toEqual([
			'openai-gpt-other',
			'openai-gpt-test',
			'openai-gpt-test-flex'
		]);
		expect(catalog.schedule[0].graph.deployments['openai-gpt-test']).toBeDefined();
		const root = JSON.parse(catalogFiles(catalog).rootJson);
		// A model retires with its last deployment, and a model without one never does.
		expect(root.summaries.models['gpt-other'].retirementDate).toBe('2026-05-01');
		expect(root.summaries.models['gpt-test'].retirementDate).toBe('2026-09-01');
		expect(root.summaries.models['gpt-listed'].retirementDate).toBeNull();
		expect(root.summaries.authors.openai.retirementDate).toBeNull();
		expect(root.summaries.providers.openai.retirementDate).toBe('2026-09-01');
		// Readers leave out the part of the dated records once the last of them has retired.
		expect(root.parts.map(({ through }: { through: string | null }) => through)).toEqual([
			null,
			'2026-09-01'
		]);
		expect(partsInEffect(root, Date.parse('2026-09-02T11:59:59Z'))).toEqual([0, 1]);
		expect(partsInEffect(root, Date.parse('2026-09-02T12:00:00Z'))).toEqual([0]);
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
			const base = buildCatalog(source).graph.deployments['openai-gpt-test'];
			expect(base.maxInputTokens).toBe(1000);
			source.graph.models['gpt-test'].maxInputTokens = 900;
			source.graph.deployments['openai-gpt-test'].overrides = { contextWindowTokens: 800 };
			expect(buildCatalog(source).graph.deployments['openai-gpt-test'].maxInputTokens).toBe(800);
			delete source.graph.deployments['openai-gpt-test'].overrides;
			expect(buildCatalog(source).graph.deployments['openai-gpt-test'].maxInputTokens).toBe(900);
			source.graph.models['gpt-test'].maxInputTokens = 1001;
			expect(() => buildCatalog(source)).toThrow('input limit must fit inside');
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
			expect(buildCatalog(valid).graph.deployments['openai-gpt-test']).toMatchObject({
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

		test('narrows input, modalities, reasoning and hosted tools', () => {
			const valid = changed((source) => {
				source.graph.models['gpt-test'].outputModalities = ['text', 'image'];
				source.graph.routes['openai-responses'].hostedTools = [openaiWebSearch('10')];
				source.graph.deployments['openai-gpt-test'].overrides = {
					maxInputTokens: 600,
					inputModalities: ['text'],
					outputModalities: ['text'],
					reasoning: 'unsupported',
					reasoningEfforts: [],
					hostedTools: { web_search: false }
				};
			});
			const deployment = buildCatalog(valid).graph.deployments['openai-gpt-test'];
			expect(deployment).toMatchObject({
				maxInputTokens: 600,
				outputModalities: ['text'],
				reasoning: 'unsupported',
				routes: { 'openai-responses': { inputModalities: ['text'], reasoningEfforts: [] } }
			});
			expect(deployment.routes['openai-responses'].hostedTools).toEqual({});
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
				'wider input',
				(source: Source) => {
					source.graph.models['gpt-test'].maxInputTokens = 900;
					source.graph.deployments['openai-gpt-test'].overrides = { maxInputTokens: 950 };
				},
				'input limit may only narrow'
			],
			[
				'modality the model lacks',
				(source: Source) =>
					(source.graph.deployments['openai-gpt-test'].overrides = {
						outputModalities: ['text', 'image']
					}),
				'overrides.outputModalities may only remove a modality'
			],
			[
				'modality the route lacks',
				(source: Source) => {
					source.graph.routes['openai-responses'].inputModalities = ['text'];
					source.graph.deployments['openai-gpt-test'].overrides = { inputModalities: ['text'] };
				},
				'overrides.inputModalities does not change what the deployment serves'
			],
			[
				'tool the route does not run',
				(source: Source) =>
					(source.graph.deployments['openai-gpt-test'].overrides = {
						hostedTools: { web_fetch: false }
					}),
				'overrides.hostedTools.web_fetch does not change what the deployment serves'
			],
			[
				'reasoning that the model requires',
				(source: Source) => {
					source.graph.models['gpt-test'].reasoning = 'required';
					source.graph.deployments['openai-gpt-test'].overrides = { reasoning: 'unsupported' };
				},
				'overrides.reasoning may only narrow optional reasoning'
			],
			[
				'unsupported reasoning with efforts',
				(source: Source) =>
					(source.graph.deployments['openai-gpt-test'].overrides = { reasoning: 'unsupported' }),
				'unsupported reasoning cannot expose controls'
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
					source.graph.routes['openai-responses'].capabilities.structuredOutputs = false;
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
					Object.entries(buildCatalog(source).graph.deployments['openai-gpt-test'].routes).map(
						([routeId, route]) => [routeId, route.reasoningEfforts]
					)
				);
			expect(efforts()).toEqual({
				'openai-chat-completions': ['low', 'high'],
				'openai-responses': ['low']
			});

			// A route that translates several interfaces keeps the deployment's list.
			source.graph.deployments['openai-gpt-test'].routeIds = ['openai-responses'];
			source.graph.routes['openai-responses'].interfaces = ['chat_completions', 'responses'];
			expect(efforts()).toEqual({ 'openai-responses': ['low', 'high'] });

			// A route left with none of the deployment's efforts is a source error.
			source.graph.routes['openai-responses'].interfaces = ['responses'];
			source.graph.deployments['openai-gpt-test'].overrides = { reasoningEfforts: ['high'] };
			expect(efforts).toThrow(
				'openai-gpt-test: openai-responses serves none of its reasoning efforts'
			);
		});

		test('keeps facts that differ between routes on each route', () => {
			const source = sourceFixture();
			addSecondOpenAIRoute(source);
			source.graph.routes['openai-chat-completions'].capabilities.streaming = false;
			source.graph.routes['openai-chat-completions'].inputModalities = ['text'];
			source.graph.routes['openai-responses'].hostedTools = [openaiWebSearch('10')];
			source.graph.deployments['openai-gpt-test'].routeIds.push('openai-chat-completions');
			const { pricing, routes } = buildCatalog(source).graph.deployments['openai-gpt-test'];
			expect(routes['openai-chat-completions'].capabilities.streaming).toBe(false);
			expect(routes['openai-responses'].capabilities.streaming).toBe(true);
			expect(routes['openai-chat-completions'].inputModalities).toEqual(['text']);
			expect(routes['openai-responses'].inputModalities).toEqual(['text', 'image']);
			// The deployment's prices hold on both routes, and each route prices the tools that it runs.
			expect(Object.keys(pricing)).toEqual(['input_tokens', 'output_tokens']);
			expect(routes['openai-chat-completions'].hostedTools).toEqual({});
			expect(routes['openai-responses'].hostedTools).toEqual({
				web_search: { dataHandling: {}, pricing: openaiWebSearch('10').pricing }
			});
		});
	});

	test('rejects contradictory data handling while allowing valid TEE and zero retention', () => {
		expect(() =>
			buildCatalog(
				changed((source) => {
					source.graph.providers.openai.dataHandling.teeVerified = true;
				})
			)
		).toThrow('verified TEE handling requires TEE processing');
		expect(() =>
			buildCatalog(
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
				buildCatalog(
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
			buildCatalog(valid).graph.deployments['openai-gpt-test'].routes['openai-responses']
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
			buildCatalog(
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

	test('records unknown training use as null, which zero data retention cannot claim', () => {
		const unknown = buildCatalog(
			changed((source) => {
				source.graph.providers.openai.dataHandling.trainingUse = null;
			})
		);
		expect(
			unknown.graph.deployments['openai-gpt-test'].routes['openai-responses'].dataHandling
				.trainingUse
		).toBeNull();
		expect(() =>
			buildCatalog(
				changed((source) => {
					source.graph.providers.openai.dataHandling = {
						...source.graph.providers.openai.dataHandling,
						storageLocation: 'none',
						retentionDays: 0,
						trainingUse: null,
						zeroDataRetention: true
					};
				})
			)
		).toThrow('zero data retention conflicts with data handling');
	});

	test('rejects end-to-end encryption that does not run in a TEE', () => {
		expect(() =>
			buildCatalog(
				changed((source) => {
					source.graph.routes['openai-responses'].dataHandling = { endToEndEncrypted: true };
				})
			)
		).toThrow('openai-responses: end-to-end encryption requires TEE processing');
		expect(() =>
			buildCatalog(
				changed((source) => {
					source.graph.providers.openai.dataHandling.tee = true;
					source.graph.routes['openai-responses'].dataHandling = { endToEndEncrypted: true };
					source.graph.deployments['openai-gpt-test'].overrides = {
						dataHandling: { tee: false }
					};
				})
			)
		).toThrow('openai-gpt-test on openai-responses: end-to-end encryption requires TEE processing');
	});

	test('lets a route state its data handling over its provider, and deployments override the route', () => {
		const route = {
			endToEndEncrypted: false,
			processingLocation: 'unknown',
			storageLocation: 'none',
			retentionDays: null,
			trainingUse: null
		};
		const source = changed((candidate) => {
			candidate.graph.routes['openai-responses'].dataHandling = route;
		});
		const { graph } = buildCatalog(source);
		expect(graph.routes['openai-responses'].dataHandling).toEqual({
			endToEndEncrypted: false,
			processingLocation: 'unknown',
			storageLocation: 'none',
			retentionDays: null,
			trainingUse: null,
			zeroDataRetention: false,
			tee: false,
			teeVerified: false,
			sharedWith: [],
			certifications: []
		});
		expect(
			graph.deployments['openai-gpt-test'].routes['openai-responses'].dataHandling
		).toMatchObject(route);

		source.graph.deployments['openai-gpt-test'].overrides = {
			dataHandling: { retentionDays: 5 }
		};
		expect(
			buildCatalog(source).graph.deployments['openai-gpt-test'].routes['openai-responses']
				.dataHandling.retentionDays
		).toBe(5);
	});

	test('compiles each guarantee that source leaves out as false', () => {
		const { graph } = buildCatalog(
			changed((source) => {
				const { zeroDataRetention, tee, teeVerified, ...facts } =
					source.graph.providers.openai.dataHandling;
				expect([zeroDataRetention, tee, teeVerified]).toEqual([false, false, false]);
				source.graph.providers.openai.dataHandling = facts as never;
				delete (source.graph.routes['openai-responses'] as { dataHandling?: unknown }).dataHandling;
			})
		);
		const guarantees = {
			endToEndEncrypted: false,
			zeroDataRetention: false,
			tee: false,
			teeVerified: false
		};
		expect(graph.routes['openai-responses'].dataHandling).toMatchObject(guarantees);
		expect(
			graph.deployments['openai-gpt-test'].routes['openai-responses'].dataHandling
		).toMatchObject(guarantees);
	});

	test('rejects a route data handling fact that repeats its provider', () => {
		expect(() =>
			buildCatalog(
				changed((source) => {
					source.graph.routes['openai-responses'].dataHandling = {
						endToEndEncrypted: false,
						retentionDays: 30
					};
				})
			)
		).toThrow(
			'openai-responses.dataHandling.retentionDays redundantly repeats its inherited value'
		);
	});

	describe('selects Chutes upstreams by the kind of route', () => {
		const chuteId = '08901219-159f-55a7-87cf-9d0d02744668';

		function chutesSource(
			routeId: string,
			upstream: Record<string, unknown>,
			id = 'chutes-gpt-test'
		) {
			return changed((source) => {
				source.companies.chutes = { name: 'Chutes', headquarteredCountry: 'US' };
				source.graph.providers.chutes = {
					name: 'Chutes',
					stogasManaged: true,
					companyId: 'chutes',
					dataHandling: {
						processingLocation: 'world',
						storageLocation: 'unknown',
						retentionDays: null,
						trainingUse: false,
						zeroDataRetention: false,
						tee: true,
						teeVerified: false
					}
				} as never;
				source.graph.routes['chutes-chat-completions'] = {
					providerId: 'chutes',
					interfaces: ['chat_completions'],
					inputModalities: ['text'],
					capabilities: structuredClone(capabilities),
					sampling: structuredClone(sampling),
					dataHandling: { endToEndEncrypted: true },
					hostedTools: []
				};
				source.graph.routes['chutes-standard-chat-completions'] = {
					providerId: 'chutes',
					hosting: 'unknown',
					interfaces: ['chat_completions'],
					inputModalities: ['text'],
					capabilities: structuredClone(capabilities),
					sampling: structuredClone(sampling),
					dataHandling: { endToEndEncrypted: false, trainingUse: null, tee: false },
					hostedTools: []
				};
				source.graph.deployments[id] = {
					modelId: 'gpt-test',
					routeIds: [routeId],
					hosting: undefined,
					upstream: { model: 'org/gpt-test', chuteId, ...upstream } as never,
					pricing: {
						input_tokens: { per_mill_tokens: '1' },
						output_tokens: { per_mill_tokens: '2' }
					}
				};
			});
		}

		test.each([
			{
				name: 'Chutes runs it on an encrypted route, with a GPU count',
				routeId: 'chutes-chat-completions',
				hosting: 'chutes',
				upstream: { gpuCount: 8 },
				id: 'chutes-gpt-test'
			},
			{
				name: 'Chutes forwards it on a standard route to an operator that it does not name',
				routeId: 'chutes-standard-chat-completions',
				hosting: 'unknown',
				upstream: {},
				id: 'chutes-gpt-test-unknown-hosted'
			}
		])('accepts a deployment that $name', ({ routeId, hosting, upstream, id }) => {
			const { graph } = buildCatalog(chutesSource(routeId, upstream, id));
			// The route says who runs its deployments.
			expect(graph.deployments[id].hosting).toBe(hosting);
			expect(graph.deployments[id].upstream).toEqual({
				model: 'org/gpt-test',
				chuteId,
				...upstream,
				serviceTier: 'standard'
			});
		});

		test.each([
			['an encrypted route without a GPU count', 'chutes-chat-completions', {}, 'chutes-gpt-test'],
			[
				'a standard route with a GPU count',
				'chutes-standard-chat-completions',
				{ gpuCount: 8 },
				'chutes-gpt-test-unknown-hosted'
			]
		])('rejects %s', (_name, routeId, upstream, id) => {
			expect(() => buildCatalog(chutesSource(routeId, upstream, id))).toThrow(
				`${id}: upstream selector does not match provider chutes`
			);
		});

		test('rejects a deployment whose routes take different selectors', () => {
			const source = chutesSource('chutes-chat-completions', { gpuCount: 8 });
			// Both routes serve chat completions, so the deployment needs a route of another interface.
			source.graph.routes['chutes-standard-chat-completions'].interfaces = ['responses'];
			const deployment = source.graph.deployments['chutes-gpt-test'];
			deployment.routeIds.push('chutes-standard-chat-completions');
			// The routes name different hostings, so the deployment must name its own.
			expect(() => buildCatalog(source)).toThrow(
				'chutes-gpt-test: its routes name different hostings, so name its own'
			);
			deployment.hosting = 'chutes';
			expect(() => buildCatalog(source)).toThrow(
				'chutes-gpt-test: upstream selector does not match provider chutes'
			);
		});
	});

	describe('accepts only canonical interfaces', () => {
		testRejections([
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
					source.graph.routes['openai-responses'].hostedTools = [openaiWebSearch('1')];
					(source.graph.deployments['openai-gpt-test'].pricing as Record<string, unknown>)[
						'openai_responses_web_search_calls'
					] = { per_1k_calls: '2' };
				},
				'openai-gpt-test.pricing.openai_responses_web_search_calls repeats the web_search price of route openai-responses'
			],
			[
				'hosted tool call meter of another tool',
				(source: Source) => {
					source.graph.routes['openai-responses'].hostedTools = [
						{
							tool: 'web_fetch',
							pricing: { openai_responses_web_search_calls: { per_1k_calls: '1' } },
							dataHandling: {}
						}
					];
				},
				'openai-responses.hostedTools[0]: web_fetch has no call meter openai_responses_web_search_calls'
			],
			[
				'hosted tool offered twice',
				(source: Source) => {
					source.graph.routes['openai-responses'].hostedTools = [
						openaiWebSearch('1'),
						openaiWebSearch('2')
					];
				},
				'openai-responses: each hosted tool has one offer'
			],
			[
				'web search without every call meter of its wire',
				(source: Source) => {
					source.graph.routes['openai-responses'].hostedTools = [
						{
							tool: 'web_search',
							pricing: { openai_responses_web_search_calls: { per_1k_calls: '1' } },
							dataHandling: {}
						}
					];
				},
				'openai-gpt-test on openai-responses: web search needs exactly the meters'
			],
			[
				'hosted tool data handling in an unlisted place',
				(source: Source) => {
					source.graph.routes['openai-responses'].hostedTools = [
						{ tool: 'web_fetch', dataHandling: { processingLocation: 'mars' } }
					];
				},
				'openai-responses.hostedTools[0]: dataHandling names a place that locations does not list'
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
					source.graph.models['openai-gpt-test'] = structuredClone(source.graph.models['gpt-test']);
				},
				'openai-gpt-test selects both model:openai-gpt-test and deployment:openai-gpt-test'
			],
			[
				'model selector collision under request matching',
				(source: Source) => {
					source.graph.models['openai.gpt.test'] = structuredClone(source.graph.models['gpt-test']);
				},
				'openai-gpt-test selects both model:openai.gpt.test and deployment:openai-gpt-test'
			],
			[
				'group selector collision under request matching',
				(source: Source) =>
					Object.assign(source.graph, {
						groups: {
							'gpt.test': { authorId: 'openai', name: 'GPT Test' },
							'gpt-test': { authorId: 'openai', name: 'GPT Test' }
						}
					}),
				'gpt-test selects both group:gpt.test and group:gpt-test'
			],
			[
				'alias that only respells the ID',
				(source: Source) => (source.graph.models['gpt-test'].aliases = ['gpt.test']),
				'gpt-test: alias gpt.test only respells the ID'
			],
			[
				'alias that names another model',
				(source: Source) => (source.graph.models['gpt-test'].aliases = ['gpt-latest']),
				'gpt-test: alias gpt-latest must move one word of the ID across its version, add or remove its snapshot date, or name its group whose ID begins the ID'
			],
			[
				'alias that moves the first word',
				(source: Source) => (source.graph.models['gpt-test'].aliases = ['test-gpt']),
				'gpt-test: alias test-gpt must move one word'
			],
			[
				'alias that moves a word across another word',
				(source: Source) => {
					source.graph.models['gpt-test-4-5'] = {
						...source.graph.models['gpt-test'],
						name: 'GPT Test 4.5',
						aliases: ['test-gpt-4-5']
					};
				},
				'gpt-test-4-5: alias test-gpt-4-5 must move one word'
			],
			[
				'snapshot alias with another date',
				(source: Source) =>
					Object.assign(source.graph.models['gpt-test'], {
						aliases: ['gpt-test-2026-01-03'],
						snapshot: '2026-01-02'
					}),
				'gpt-test: alias gpt-test-2026-01-03 must move one word'
			],
			[
				'snapshot alias in a short date form',
				(source: Source) =>
					Object.assign(source.graph.models['gpt-test'], {
						aliases: ['gpt-test-0102'],
						snapshot: '2026-01-02'
					}),
				'gpt-test: alias gpt-test-0102 must move one word'
			],
			[
				'alias that names a group whose ID does not begin the ID',
				(source: Source) => {
					Object.assign(source.graph, { groups: { other: { authorId: 'openai', name: 'Other' } } });
					Object.assign(source.graph.models['gpt-test'], {
						aliases: ['other'],
						groupIds: ['other']
					});
				},
				'gpt-test: alias other must move one word'
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
				'deployment ID that its facts do not give',
				(source: Source) => {
					const deployment = source.graph.deployments['openai-gpt-test'];
					source.graph.deployments = { 'openai-gpt-test-a': deployment };
				},
				"openai-gpt-test-a: the deployment's facts name it openai-gpt-test"
			],
			[
				'deployment ID without its tier',
				(source: Source) =>
					(source.graph.deployments['openai-gpt-test'].upstream.serviceTier = 'flex'),
				"openai-gpt-test: the deployment's facts name it openai-gpt-test-flex"
			]
		]);
	});

	test('names a deployment by who runs it, its mode, its tier and where it runs', () => {
		const source = changed(asAzure);
		const deployment = source.graph.deployments['azure-gpt-test'];
		deployment.hosting = 'fireworks';
		source.companies.fireworks = { name: 'Fireworks AI', headquarteredCountry: 'US' };
		Object.assign(deployment.upstream, {
			modelFormat: 'Fireworks',
			deploymentType: 'data_zone_standard_us'
		});
		source.graph.deployments = { 'azure-gpt-test-fireworks-hosted-us': deployment };
		expect(
			buildCatalog(source).graph.deployments['azure-gpt-test-fireworks-hosted-us'].hosting
		).toBe('fireworks');

		const pro = changed((candidate) => {
			const upstream = candidate.graph.deployments['openai-gpt-test'].upstream;
			Object.assign(upstream, { reasoningMode: 'pro', serviceTier: 'flex' });
			candidate.graph.deployments = {
				'openai-gpt-test-pro-flex': candidate.graph.deployments['openai-gpt-test']
			};
		});
		expect(buildCatalog(pro).graph.deployments['openai-gpt-test-pro-flex']).toBeDefined();
	});

	describe('names who runs a deployment and who else receives its requests', () => {
		const company = { headquarteredCountry: 'US' };

		/** Azure's deployment with a hosting of its own, under the ID that the hosting gives it. */
		function hosted(hosting: string | undefined, id: string, mutate?: Mutator) {
			return changed((source) => {
				asAzure(source);
				const deployment = source.graph.deployments['azure-gpt-test'];
				deployment.hosting = hosting;
				if (hosting && hosting !== 'unknown' && hosting !== 'microsoft')
					source.companies[hosting] = { name: hosting, ...company };
				source.graph.deployments = { [id]: deployment };
				mutate?.(source);
			});
		}

		test("takes the provider's company when no record names another", () => {
			const { graph, companies } = buildCatalog(hosted(undefined, 'azure-gpt-test'));
			expect(graph.deployments['azure-gpt-test'].hosting).toBe('microsoft');
			expect(graph.deployments['azure-gpt-test']).not.toHaveProperty('companies');
			// A route's record states no hosting, because a deployment can name another.
			expect(graph.routes['azure-responses']).not.toHaveProperty('hosting');
			expect(graph.providers.azure).toMatchObject({
				companyId: 'microsoft',
				headquarteredCountry: 'US'
			});
			expect(companies.microsoft).toEqual({ name: 'Microsoft', headquarteredCountry: 'US' });
		});

		test.each([
			['anthropic', 'azure-gpt-test-anthropic-hosted'],
			['unknown', 'azure-gpt-test-unknown-hosted']
		])('names %s in the ID of a deployment that names it', (hosting, id) => {
			expect(buildCatalog(hosted(hosting, id)).graph.deployments[id].hosting).toBe(hosting);
		});

		test('gives every deployment of a route the hosting that the route names', () => {
			const id = 'azure-gpt-test-anthropic-hosted';
			const source = hosted(undefined, id, (candidate) => {
				candidate.companies.anthropic = { name: 'Anthropic', ...company };
				candidate.graph.routes['azure-responses'].hosting = 'anthropic';
			});
			expect(buildCatalog(source).graph.deployments[id].hosting).toBe('anthropic');
			// A deployment can still name another.
			source.companies.fireworks = { name: 'Fireworks AI', ...company };
			source.graph.deployments = {
				...source.graph.deployments,
				'azure-gpt-test-fireworks-hosted': {
					...source.graph.deployments[id],
					hosting: 'fireworks'
				}
			};
			expect(
				buildCatalog(source).graph.deployments['azure-gpt-test-fireworks-hosted'].hosting
			).toBe('fireworks');
		});

		test.each([
			[
				"a route that repeats its provider's company",
				hosted(undefined, 'azure-gpt-test', (source) => {
					source.graph.routes['azure-responses'].hosting = 'microsoft';
				}),
				"azure-responses.hosting redundantly repeats its provider's company"
			],
			[
				"a deployment that repeats its route's hosting",
				hosted('microsoft', 'azure-gpt-test'),
				"azure-gpt-test.hosting redundantly repeats its route's hosting"
			],
			[
				'a hosting that companies does not list',
				hosted('anthropic', 'azure-gpt-test-anthropic-hosted', (source) => {
					delete source.companies.anthropic;
				}),
				'azure-gpt-test-anthropic-hosted: companies does not list the hosting anthropic'
			],
			[
				'a company that no record names',
				hosted(undefined, 'azure-gpt-test', (source) => {
					source.companies.fireworks = { name: 'Fireworks AI', ...company };
				}),
				'Company fireworks: no record names it, so remove it'
			],
			[
				'a provider whose company is not listed',
				hosted(undefined, 'azure-gpt-test', (source) => {
					delete source.companies.microsoft;
				}),
				'provider azure: companies does not list microsoft'
			]
		])('rejects %s', (_name, source, message) => {
			expect(() => buildCatalog(source)).toThrow(message);
		});

		test('lists the companies that requests are shared with on each record that states them', () => {
			const shared = (source: Source, sharedWith: string[]) => {
				for (const id of sharedWith)
					if (id !== 'unknown') source.companies[id] = { name: id, ...company };
			};
			// A provider's list holds on its routes and deployments.
			const provider = hosted(undefined, 'azure-gpt-test', (source) => {
				shared(source, ['anthropic']);
				Object.assign(source.graph.providers.azure.dataHandling, { sharedWith: ['anthropic'] });
			});
			const sharedWith = (source: Source, id = 'azure-gpt-test') =>
				buildCatalog(source).graph.deployments[id].routes['azure-responses'].dataHandling
					.sharedWith;
			expect(sharedWith(provider)).toEqual(['anthropic']);
			// A route's list replaces it, and a deployment's replaces that.
			shared(provider, ['fireworks']);
			Object.assign(provider.graph.routes['azure-responses'].dataHandling, {
				sharedWith: ['fireworks', 'unknown']
			});
			expect(() => buildCatalog(provider)).toThrow(
				'Company anthropic: no record names it, so remove it'
			);
			provider.graph.deployments['azure-gpt-test'].overrides = {
				dataHandling: { sharedWith: [] }
			};
			expect(() => buildCatalog(provider)).toThrow(
				'Company anthropic: no record names it, so remove it'
			);
			provider.graph.deployments['azure-gpt-test'].overrides = {
				dataHandling: { sharedWith: ['anthropic', 'fireworks', 'unknown'] }
			};
			expect(sharedWith(provider)).toEqual(['anthropic', 'fireworks', 'unknown']);
			// A record that states none has an empty list.
			expect(sharedWith(hosted(undefined, 'azure-gpt-test'))).toEqual([]);
		});

		test.each([
			["the provider's company", 'anthropic', ['microsoft']],
			['the hosting', 'anthropic', ['anthropic']],
			['a company twice', 'anthropic', ['openai', 'openai']],
			['companies out of order', 'anthropic', ['unknown', 'openai']],
			['a company that companies does not list', 'anthropic', ['fireworks']]
		])('rejects sharing with %s', (_name, hosting, sharedWith) => {
			const id = 'azure-gpt-test-anthropic-hosted';
			const source = hosted(hosting, id, (candidate) => {
				candidate.graph.deployments[id].overrides = { dataHandling: { sharedWith } };
			});
			expect(() => buildCatalog(source)).toThrow(`${id} on azure-responses: sharedWith`);
		});

		test('lists the companies that a hosted tool sends content to', () => {
			const source = changed((candidate) => {
				candidate.graph.routes['openai-responses'].hostedTools = [
					{ tool: 'web_fetch', dataHandling: { sharedWith: ['unknown'] } }
				];
			});
			const { graph } = buildCatalog(source);
			expect(
				graph.deployments['openai-gpt-test'].routes['openai-responses'].hostedTools.web_fetch
					.dataHandling
			).toEqual({ sharedWith: ['unknown'] });
			source.graph.routes['openai-responses'].hostedTools = [
				{ tool: 'web_fetch', dataHandling: { sharedWith: ['fireworks'] } }
			];
			expect(() => buildCatalog(source)).toThrow(
				'openai-responses.hostedTools[0]: sharedWith must list companies'
			);
		});

		test('lists the certifications of the company that runs a deployment', () => {
			const certifications = (source: Source, id = 'azure-gpt-test') =>
				buildCatalog(source).graph.deployments[id].routes['azure-responses'].dataHandling
					.certifications;
			const listed = (list: string[], hosting?: string, id = 'azure-gpt-test') =>
				hosted(hosting, id, (source) => {
					Object.assign(source.graph.providers.azure.dataHandling, { certifications: list });
				});
			// A record that states none has an empty list, and a provider's list holds on its
			// deployments.
			expect(certifications(hosted(undefined, 'azure-gpt-test'))).toEqual([]);
			const government = ['soc2-type2', 'fedramp-moderate', 'fedramp-high', 'dod-il2', 'dod-il4'];
			expect(certifications(listed(government))).toEqual(government);
			for (const [list, message] of [
				[['iso-27001', 'soc2-type2'], 'certifications must use canonical order'],
				[['soc2-type2', 'soc2-type2'], 'certifications must use canonical order'],
				[['soc-2'], 'certifications must use canonical order'],
				[['fedramp-high'], 'certifications lists fedramp-high, which includes fedramp-moderate'],
				[['dod-il2', 'dod-il5'], 'certifications lists dod-il5, which includes dod-il4']
			] as const)
				expect(() => buildCatalog(listed([...list]))).toThrow(message);
			// An audit covers the company that runs the service, so a deployment that another
			// company runs states its own list, which can be empty.
			const id = 'azure-gpt-test-anthropic-hosted';
			const other = listed(['soc2-type2'], 'anthropic', id);
			expect(() => buildCatalog(other)).toThrow(
				`${id} on azure-responses: state the certifications of anthropic, which runs it`
			);
			other.graph.deployments[id].overrides = { dataHandling: { certifications: [] } };
			expect(certifications(other, id)).toEqual([]);
			other.graph.deployments[id].overrides = {
				dataHandling: { certifications: ['iso-27001', 'iso-42001'] }
			};
			expect(certifications(other, id)).toEqual(['iso-27001', 'iso-42001']);
		});

		test('lets a hosted tool remove only certifications that its route lists', () => {
			const source = changed((candidate) => {
				Object.assign(candidate.graph.providers.openai.dataHandling, {
					certifications: ['soc2-type2', 'hipaa-eligible']
				});
				candidate.graph.routes['openai-responses'].hostedTools = [
					{ tool: 'web_fetch', dataHandling: { withoutCertifications: ['hipaa-eligible'] } }
				];
			});
			expect(
				buildCatalog(source).graph.deployments['openai-gpt-test'].routes['openai-responses']
					.hostedTools.web_fetch.dataHandling
			).toEqual({ withoutCertifications: ['hipaa-eligible'] });
			source.graph.routes['openai-responses'].hostedTools = [
				{ tool: 'web_fetch', dataHandling: { withoutCertifications: ['pci-dss'] } }
			];
			expect(() => buildCatalog(source)).toThrow(
				'openai-responses.hostedTools[0]: withoutCertifications removes only what its route lists'
			);
		});
	});

	test('keeps Azure rules structural instead of model-name allowlists', () => {
		for (const modelFormat of ['OpenAI', 'OpenAI-OSS', 'DeepSeek']) {
			const source = changed(asAzure);
			source.graph.deployments['azure-gpt-test'].upstream.modelFormat = modelFormat;
			expect(buildCatalog(source).graph.deployments['azure-gpt-test'].upstream.modelFormat).toBe(
				modelFormat
			);
		}
		const fast = changed((source) => {
			asAzure(source);
			source.graph.deployments['azure-gpt-test-fast'] = structuredClone(
				source.graph.deployments['azure-gpt-test']
			);
			source.graph.deployments['azure-gpt-test-fast'].upstream.serviceTier = 'fast';
		});
		expect(buildCatalog(fast).graph.deployments['azure-gpt-test-fast']).toBeDefined();

		const instant = changed((source) => {
			asAzure(source);
			const deployment = source.graph.deployments['azure-gpt-test'];
			deployment.upstream.deploymentType = 'instant';
			source.graph.deployments = { 'azure-gpt-test-instant': deployment };
		});
		expect(buildCatalog(instant).graph.deployments['azure-gpt-test-instant']).toBeDefined();

		const batch = changed((source) => {
			asAzure(source);
			source.graph.routes['azure-responses'].batch = true;
			const deployment = source.graph.deployments['azure-gpt-test'];
			deployment.upstream.deploymentType = 'data_zone_batch_us';
			source.graph.deployments = { 'azure-gpt-test-batch-us': deployment };
		});
		expect(buildCatalog(batch).graph.deployments['azure-gpt-test-batch-us']).toBeDefined();
	});

	describe('takes the data handling that upstream fields decide', () => {
		const handling = (source: Source, id: string, routeId: string) =>
			buildCatalog(source).graph.deployments[id].routes[routeId].dataHandling;

		/** Azure's deployment with other upstream fields, under the ID that they give it. */
		function azure(upstream: Record<string, string>, id: string, mutate?: Mutator) {
			return changed((source) => {
				asAzure(source);
				const deployment = source.graph.deployments['azure-gpt-test'];
				Object.assign(deployment.upstream, upstream);
				source.graph.deployments = { [id]: deployment };
				mutate?.(source);
			});
		}

		test('an inference geography says where inference runs', () => {
			expect(
				handling(changed(asAnthropic), 'anthropic-gpt-test-us', 'anthropic-messages')
			).toMatchObject({ processingLocation: 'US', storageLocation: 'unknown' });
			// Anthropic runs a request that names no geography anywhere in the world.
			const global = changed((source) => {
				asAnthropic(source);
				const deployment = source.graph.deployments['anthropic-gpt-test-us'];
				delete deployment.upstream.inferenceGeo;
				source.graph.routes['anthropic-messages'].dataHandling.processingLocation = 'US';
				source.graph.deployments = { 'anthropic-gpt-test': deployment };
			});
			expect(handling(global, 'anthropic-gpt-test', 'anthropic-messages')).toMatchObject({
				processingLocation: 'world'
			});
		});

		test('an Azure Data Zone that Microsoft runs keeps processing and storage in its zone', () => {
			const id = 'azure-gpt-test-eu';
			expect(
				handling(azure({ deploymentType: 'data_zone_standard_eu' }, id), id, 'azure-responses')
			).toMatchObject({ processingLocation: 'europe', storageLocation: 'europe' });
			// Another company's Data Zone states its own locations.
			const other = 'azure-gpt-test-fireworks-hosted-us';
			const fireworks = azure(
				{ deploymentType: 'data_zone_standard_us', modelFormat: 'Fireworks' },
				other,
				(source) => {
					source.companies.fireworks = { name: 'Fireworks AI', headquarteredCountry: 'US' };
					source.graph.deployments[other].hosting = 'fireworks';
				}
			);
			expect(handling(fireworks, other, 'azure-responses')).toMatchObject({
				processingLocation: 'world',
				storageLocation: 'unknown'
			});
		});

		test.each([
			['Instant', { deploymentType: 'instant' }, 'azure-gpt-test-instant'],
			['Flex', { serviceTier: 'flex' }, 'azure-gpt-test-flex']
		])('Azure %s leaves storage, retention and training unknown', (_name, upstream, id) => {
			expect(handling(azure(upstream, id), id, 'azure-responses')).toMatchObject({
				processingLocation: 'world',
				storageLocation: 'unknown',
				retentionDays: null,
				trainingUse: null
			});
		});

		testRejections([
			[
				'an override of where an inference geography runs',
				(source: Source) => {
					asAnthropic(source);
					source.graph.deployments['anthropic-gpt-test-us'].overrides = {
						dataHandling: { processingLocation: 'world' }
					};
				},
				'anthropic-gpt-test-us.overrides.dataHandling.processingLocation follows from its upstream fields'
			],
			[
				'an override of where a Data Zone stores',
				(source: Source) => {
					asAzure(source);
					const deployment = source.graph.deployments['azure-gpt-test'];
					deployment.upstream.deploymentType = 'data_zone_standard_us';
					deployment.overrides = { dataHandling: { storageLocation: 'world' } };
					source.graph.deployments = { 'azure-gpt-test-us': deployment };
				},
				'azure-gpt-test-us.overrides.dataHandling.storageLocation follows from its upstream fields'
			],
			[
				'an override of what Azure Instant retains',
				(source: Source) => {
					asAzure(source);
					const deployment = source.graph.deployments['azure-gpt-test'];
					deployment.upstream.deploymentType = 'instant';
					deployment.overrides = { dataHandling: { retentionDays: 0 } };
					source.graph.deployments = { 'azure-gpt-test-instant': deployment };
				},
				'azure-gpt-test-instant.overrides.dataHandling.retentionDays follows from its upstream fields'
			]
		]);
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
				'Azure batch type on a route that is not batch',
				(source: Source) => {
					asAzure(source);
					source.graph.deployments['azure-gpt-test'].upstream.deploymentType = 'global_batch';
				},
				'azure-gpt-test: only an Azure batch deployment type serves batch routes'
			],
			[
				'Azure Global Standard on a batch route',
				(source: Source) => {
					asAzure(source);
					source.graph.routes['azure-responses'].batch = true;
				},
				'azure-gpt-test: only an Azure batch deployment type serves batch routes'
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
					addFast(source);
					delete source.graph.deployments['openai-gpt-test'];
				},
				'openai-gpt-test-fast: Fast needs a Standard deployment on openai-responses'
			],
			[
				'a Standard deployment that Stogas does not serve',
				(source: Source) => {
					addFast(source);
					Object.assign(source.graph.deployments['openai-gpt-test'], {
						stogasByok: false,
						notes: 'Not served.'
					});
				},
				'openai-gpt-test-fast: Fast needs a Standard deployment on openai-responses'
			],
			[
				'a Standard deployment that Stogas serves only in fewer ways',
				(source: Source) => {
					addFast(source);
					source.graph.providers.openai.stogasManaged = true;
					Object.assign(source.graph.deployments['openai-gpt-test'], { stogasManaged: false });
				},
				'openai-gpt-test-fast: Fast needs a Standard deployment on openai-responses'
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
		const built = buildCatalog(sourceFixture());
		expect(built.graph.deployments['openai-gpt-test'].upstream.serviceTier).toBe('standard');
		expect(built.graph.deployments['openai-gpt-test'].upstream.serviceTier).toBe('standard');
	});

	test('allows fixed reasoning mode only on Responses-only routes', () => {
		const source = changed((candidate) => {
			const deployment = candidate.graph.deployments['openai-gpt-test'];
			deployment.upstream.reasoningMode = 'pro';
			candidate.graph.deployments = { 'openai-gpt-test-pro': deployment };
		});
		expect(buildCatalog(source).graph.deployments['openai-gpt-test-pro']).toBeDefined();

		expect(() =>
			buildCatalog(
				changed((candidate) => {
					candidate.graph.routes['openai-responses'].interfaces = ['chat_completions', 'responses'];
					candidate.graph.deployments['openai-gpt-test'].upstream.reasoningMode = 'pro';
				})
			)
		).toThrow('fixed reasoning mode requires Responses-only routes');
	});

	test('allows fixed reasoning mode for an Azure-hosted OpenAI-author model', () => {
		const source = changed((candidate) => {
			asAzure(candidate);
			const deployment = candidate.graph.deployments['azure-gpt-test'];
			deployment.upstream.reasoningMode = 'pro';
			candidate.graph.deployments = { 'azure-gpt-test-pro': deployment };
		});
		expect(buildCatalog(source).graph.deployments['azure-gpt-test-pro']).toBeDefined();
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
		const original = buildCatalog(source);
		expect(original.graph.routes['openai-responses'].documentFormats).toEqual(documents);
		expect(original.graph.routes['openai-chat-completions'].documentFormats).toEqual(pdf);
		const deployment = original.graph.deployments['openai-gpt-test'];
		expect(Object.keys(deployment.routes)).toEqual(['openai-chat-completions', 'openai-responses']);
		expect(deployment.routes['openai-responses']).not.toHaveProperty('documentFormats');

		source.graph.routes['openai-responses'].documentFormats = pdf;
		const changedRoute = buildCatalog(source).graph.deployments['openai-gpt-test'];
		expect(chainHash(changedRoute)).not.toBe(chainHash(deployment));
		expect(changedRoute.routes['openai-chat-completions'].chainHash).toBe(
			deployment.routes['openai-chat-completions'].chainHash
		);
	});

	test('keep provider-processed PDFs for a text-only model', () => {
		const source = sourceFixture();
		source.graph.routes['openai-responses'].documentFormats = documents;
		source.graph.models['gpt-test'].inputModalities = ['text'];
		const { graph } = buildCatalog(source);
		expect(graph.routes['openai-responses'].documentFormats).toEqual(documents);
		expect(graph.deployments['openai-gpt-test'].routes['openai-responses'].inputModalities).toEqual(
			['text']
		);
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
		expect(() => buildCatalog(source)).toThrow(/documentFormats/);
	});
});
