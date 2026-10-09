import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../source/scripts/canonical-json.mjs';
import { buildCatalogs, main } from '../source/scripts/build.mjs';
import { mergeCatalogArchive } from '../source/scripts/catalog-archive.mjs';

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
	urlContext: false
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
						processingLocation: 'global',
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
					fileInputs: { extensions: [] as string[], mediaTypes: [] as string[] },
					dataHandling: { endToEndEncrypted: false }
				}
			},
			deployments: {
				'openai-gpt-test': {
					modelId: 'gpt-test',
					routeIds: ['openai-responses'],
					upstream: { model: 'gpt-test', serviceTier: 'default' },
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

function addSecondOpenAIRoute(source: Source) {
	source.graph.routes['openai-chat-completions'] = {
		providerId: 'openai',
		endpoint: 'https://api.openai.com/v1/chat/completions',
		interfaces: ['responses'],
		fileInputs: { extensions: [], mediaTypes: [] },
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
			deploymentType: 'global_standard',
			serviceTier: 'default'
		}
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
		expect(grouped.runtime.graph.deployments['openai-gpt-test'].chainHashes).toEqual(
			original.runtime.graph.deployments['openai-gpt-test'].chainHashes
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

	test('publishes retirement separately, keeps shared dependencies active, and commits exact archive bytes', () => {
		const source = sourceFixture();
		source.graph.groups = {
			shared: { authorId: 'openai', name: 'Shared' },
			old: { authorId: 'openai', name: 'Old', parentIds: ['shared'] }
		};
		source.graph.models['gpt-test'].groupIds = ['shared'];
		source.graph.models.old = {
			...source.graph.models['gpt-test'],
			name: 'Old model',
			groupIds: ['old'],
			retired: true,
			aliases: ['gpt-test']
		};
		source.graph.deployments.old = {
			...source.graph.deployments['openai-gpt-test'],
			modelId: 'old',
			upstream: { model: 'old', serviceTier: 'default' }
		};
		const built = buildCatalogs(source);
		expect(Object.keys(built.public.graph.models)).toEqual(['gpt-test']);
		expect(Object.keys(built.public.graph.groups)).toEqual(['shared']);
		expect(Object.keys(built.public.graph.routes)).toEqual(['openai-responses']);
		expect(Object.keys(built.runtime.graph.deployments)).toEqual(['openai-gpt-test']);
		expect(built.archive.graph.models.old.retired).toBe(true);
		expect(built.archive.graph.deployments.old.retired).toBe(true);
		expect(Object.keys(built.archive.graph.groups)).toEqual(['old']);
		expect(built.archive.graph.authors).toEqual({});
		expect(built.archive.graph.providers).toEqual({});
		expect(built.archive.graph.routes).toEqual({});
		const archiveBytes = canonicalJson(built.archive);
		expect(built.public.archive).toEqual({
			sha256: createHash('sha256').update(archiveBytes).digest('hex'),
			size_bytes: Buffer.byteLength(archiveBytes)
		});
		const merged = mergeCatalogArchive(built.public, built.archive);
		expect(Object.keys(merged.graph.models)).toEqual(['gpt-test', 'old']);
		expect(merged.graph.groups.old.parentIds).toEqual(['shared']);
		const duplicate = structuredClone(built.archive);
		duplicate.graph.models['gpt-test'] = duplicate.graph.models.old;
		expect(() => mergeCatalogArchive(built.public, duplicate)).toThrow('duplicates an active');
		source.graph.models['gpt-test'].retired = true;
		const allRetired = buildCatalogs(source);
		expect(
			Object.values(allRetired.public.graph).every((records) => Object.keys(records).length === 0)
		).toBe(true);
		expect(
			Object.values(allRetired.runtime.graph).every((records) => Object.keys(records).length === 0)
		).toBe(true);
		expect(Object.keys(allRetired.archive.graph.providers)).toEqual(['openai']);
	});

	test('retiring one deployment preserves a model still served through another target', () => {
		const source = sourceFixture();
		source.graph.deployments.old = {
			...source.graph.deployments['openai-gpt-test'],
			upstream: { model: 'old', serviceTier: 'default' },
			retired: true
		};
		const built = buildCatalogs(source);
		expect(Object.keys(built.public.graph.models)).toEqual(['gpt-test']);
		expect(Object.keys(built.public.graph.deployments)).toEqual(['openai-gpt-test']);
		expect(Object.keys(built.archive.graph.deployments)).toEqual(['old']);
		expect(Object.keys(built.runtime.graph.deployments)).toEqual(['openai-gpt-test']);
	});

	test.each(['0', '0.001', '0.042', '0.000000000000000000000000000000000001', '1000000000000'])(
		'preserves exact rate %s USD in both catalog artifacts',
		(rate) => {
			const source = sourceFixture();
			source.graph.deployments['openai-gpt-test'].pricing.output_tokens.per_mill_tokens = rate;
			const catalogs = buildCatalogs(source);
			for (const artifact of [catalogs.public, catalogs.runtime]) {
				expect(
					artifact.graph.deployments['openai-gpt-test'].pricing.output_tokens.per_mill_tokens
				).toBe(rate);
			}
		}
	);
	test('materializes one minimal graph without leaking public-only policy into runtime', () => {
		const catalogs = buildCatalogs(sourceFixture());
		expect(catalogs.runtime.graph.deployments['openai-gpt-test']).toMatchObject({
			contextWindowTokens: 1000,
			maxOutputTokens: 200,
			reasoningEfforts: ['low', 'high']
		});
		expect(catalogs.runtime.graph.providers.openai).toEqual({
			aliases: [],
			credentialModes: ['byok'],
			name: 'OpenAI'
		});
		expect(catalogs.public.graph.providers.openai).not.toHaveProperty('moderated');
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
				'impossible deprecation date',
				(source: Source) => (source.graph.models['gpt-test'].deprecationDate = '2026-02-30'),
				'deprecationDate is invalid'
			],
			[
				'deprecation before release',
				(source: Source) => (source.graph.models['gpt-test'].deprecationDate = '2026-01-01'),
				'deprecationDate precedes releaseDate'
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
				'reasoning efforts must use canonical order without repeats'
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
		source.graph.models['gpt-test'].deprecationDate = '2026-01-02';
		source.graph.models['gpt-test'].reasoningMaxTokens = { minimum: 1, maximum: 199 };
		asAzureClaude(source);
		source.graph.deployments['azure-gpt-test'].overrides = {
			dataHandling: { processingLocation: 'unknown' }
		};
		const catalogs = buildCatalogs(source);
		expect(catalogs.public.graph.models['gpt-test']).toMatchObject({
			snapshot: '2026-01-02',
			deprecationDate: '2026-01-02',
			reasoningMaxTokens: { minimum: 1, maximum: 199 }
		});

		const deploymentBoundary = sourceFixture();
		deploymentBoundary.graph.deployments['openai-gpt-test'].overrides = {
			deprecationDate: '2026-01-02'
		};
		expect(
			buildCatalogs(deploymentBoundary).runtime.graph.deployments['openai-gpt-test'].deprecationDate
		).toBe('2026-01-02');
	});

	testRejections([
		[
			'rejects deployment deprecation before the model release',
			(source) => {
				source.graph.deployments['openai-gpt-test'].overrides = {
					deprecationDate: '2026-01-01'
				};
			},
			'deprecationDate precedes model releaseDate'
		],
		[
			'rejects an impossible deployment deprecation date',
			(source) => {
				source.graph.deployments['openai-gpt-test'].overrides = {
					deprecationDate: '2026-02-30'
				};
			},
			'deprecationDate is invalid'
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
			source.graph.deployments['openai-gpt-test'].overrides = { maxInputTokens: 700 };
			expect(buildCatalogs(source).runtime.graph.deployments['openai-gpt-test']).toMatchObject({
				contextWindowTokens: 1000,
				maxInputTokens: 700,
				maxOutputTokens: 200
			});
			source.graph.deployments['openai-gpt-test'].overrides = { maxInputTokens: 901 };
			expect(() => buildCatalogs(source)).toThrow('input limit may only narrow');
			source.graph.deployments['openai-gpt-test'].overrides = {
				contextWindowTokens: 800,
				maxInputTokens: 850
			};
			expect(() => buildCatalogs(source)).toThrow('input limit may only narrow');
			source.graph.models['gpt-test'].maxInputTokens = 1001;
			expect(() => buildCatalogs(source)).toThrow('input limit must fit inside');
		});

		test('materializes valid narrowing', () => {
			const valid = changed((source) => {
				source.graph.deployments['openai-gpt-test'].overrides = {
					contextWindowTokens: 800,
					maxOutputTokens: 100,
					inputModalities: ['text'],
					reasoningEfforts: ['high']
				};
			});
			expect(buildCatalogs(valid).runtime.graph.deployments['openai-gpt-test']).toMatchObject({
				contextWindowTokens: 800,
				maxOutputTokens: 100,
				inputModalities: ['text'],
				reasoningEfforts: ['high']
			});
		});

		testRejections([
			[
				'redundant context',
				(source: Source) =>
					(source.graph.deployments['openai-gpt-test'].overrides = {
						contextWindowTokens: 1000
					}),
				'redundantly repeats its inherited value'
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
				'new modality',
				(source: Source) =>
					(source.graph.deployments['openai-gpt-test'].overrides = {
						inputModalities: ['text', 'video']
					}),
				'cannot enable model-unsupported inputModalities value video'
			],
			[
				'noncanonical output modality override',
				(source: Source) => {
					source.graph.models['gpt-test'].outputModalities = ['text', 'image'];
					source.graph.deployments['openai-gpt-test'].overrides = {
						outputModalities: ['image', 'text']
					};
				},
				'outputModalities must use canonical order without repeats'
			],
			[
				'new model-disabled capability',
				(source: Source) => {
					source.graph.models['gpt-test'].capabilities = { structuredOutputs: false };
					source.graph.deployments['openai-gpt-test'].overrides = {
						capabilities: { structuredOutputs: true }
					};
				},
				'cannot enable model-unsupported capability structuredOutputs'
			],
			[
				'new route-disabled capability',
				(source: Source) => {
					source.graph.providers.openai.capabilities.structuredOutputs = false;
					source.graph.deployments['openai-gpt-test'].overrides = {
						capabilities: { structuredOutputs: true }
					};
				},
				'cannot enable route-unsupported capability structuredOutputs'
			],
			[
				'enabled unsupported reasoning',
				(source: Source) => {
					source.graph.models['gpt-test'].reasoning = 'unsupported';
					source.graph.models['gpt-test'].reasoningEfforts = [];
					source.graph.deployments['openai-gpt-test'].overrides = { reasoning: 'optional' };
				},
				'cannot enable model-unsupported reasoning'
			],
			[
				'weakened required reasoning',
				(source: Source) => {
					source.graph.models['gpt-test'].reasoning = 'required';
					source.graph.deployments['openai-gpt-test'].overrides = { reasoning: 'optional' };
				},
				'cannot weaken required model reasoning'
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
				'unattached route override',
				(source: Source) =>
					(source.graph.deployments['openai-gpt-test'].overrides = {
						routes: { missing: { reasoningEfforts: ['low'] } }
					}),
				'references unattached route missing'
			]
		]);
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
			buildCatalogs(valid).runtime.graph.deployments['openai-gpt-test'].dataHandlingByRoute[
				'openai-responses'
			];
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
				'routeIds must not repeat'
			],
			[
				'conflicting route fact',
				(source: Source) => {
					addSecondOpenAIRoute(source);
					source.graph.routes['openai-chat-completions'].overrides = {
						capabilities: { streaming: false }
					};
					source.graph.deployments['openai-gpt-test'].routeIds.push('openai-chat-completions');
				},
				'route capabilities differs; split the deployment'
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
				'conflicting route pricing',
				(source: Source) => {
					addSecondOpenAIRoute(source);
					source.graph.routes['openai-responses'].pricing = {
						openai_responses_web_search_calls: { per_1k_calls: '1' }
					};
					source.graph.routes['openai-chat-completions'].pricing = {
						openai_responses_web_search_calls: { per_1k_calls: '2' }
					};
					source.graph.deployments['openai-gpt-test'].routeIds.push('openai-chat-completions');
				},
				'route pricing conflicts for openai_responses_web_search_calls'
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
				'pricing.openai_responses_web_search_calls must use overrides.pricing'
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
				(source: Source) => (source.graph.models['gpt-test'].aliases = ['openai-gpt-test']),
				'selects both model:gpt-test and deployment:openai-gpt-test'
			],
			[
				'noncanonical alias',
				(source: Source) => (source.graph.models['gpt-test'].aliases = ['bad/alias']),
				'selector bad/alias is not canonical'
			],
			[
				'too many aliases',
				(source: Source) =>
					(source.graph.models['gpt-test'].aliases = Array.from(
						{ length: 9 },
						(_, index) => `alias-${index}`
					)),
				'select at most 8 aliases'
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
		const priority = changed((source) => {
			asAzure(source);
			source.graph.deployments['azure-gpt-test'].upstream.serviceTier = 'priority';
		});
		expect(buildCatalogs(priority).runtime.graph.deployments['azure-gpt-test']).toBeDefined();

		const instant = changed((source) => {
			asAzure(source);
			source.graph.deployments['azure-gpt-test'].upstream.deploymentType = 'instant';
		});
		expect(buildCatalogs(instant).runtime.graph.deployments['azure-gpt-test']).toBeDefined();

		expect(() =>
			buildCatalogs(
				changed((source) => {
					asAzure(source);
					source.graph.deployments['azure-gpt-test'].upstream.serviceTier = 'priority';
					source.graph.deployments['azure-gpt-test'].upstream.deploymentType =
						'data_zone_standard_us';
				})
			)
		).toThrow('Azure Priority is unavailable for this target');
		expect(() =>
			buildCatalogs(
				changed((source) => {
					asAzure(source);
					source.graph.deployments['azure-gpt-test'].upstream.deploymentType = 'instant';
					delete source.graph.deployments['azure-gpt-test'].upstream.serviceTier;
				})
			)
		).toThrow('Azure Instant requires a default-tier Azure OpenAI target');
	});

	test('rejects Azure Priority and Instant for structurally incompatible formats and hosts', () => {
		for (const [name, mutate] of [
			[
				'Fireworks Priority',
				(source: Source) => {
					asAzure(source);
					Object.assign(source.graph.deployments['azure-gpt-test'].upstream, {
						modelFormat: 'Fireworks',
						hosting: 'fireworks',
						serviceTier: 'priority'
					});
				}
			],
			[
				'DeepSeek Priority',
				(source: Source) => {
					asAzure(source);
					Object.assign(source.graph.deployments['azure-gpt-test'].upstream, {
						modelFormat: 'DeepSeek',
						serviceTier: 'priority'
					});
				}
			],
			[
				'Fireworks Instant',
				(source: Source) => {
					asAzure(source);
					Object.assign(source.graph.deployments['azure-gpt-test'].upstream, {
						modelFormat: 'Fireworks',
						hosting: 'fireworks',
						deploymentType: 'instant'
					});
				}
			],
			[
				'DeepSeek Instant',
				(source: Source) => {
					asAzure(source);
					Object.assign(source.graph.deployments['azure-gpt-test'].upstream, {
						modelFormat: 'DeepSeek',
						deploymentType: 'instant'
					});
				}
			]
		] as const) {
			expect(() => buildCatalogs(changed(mutate)), name).toThrow(
				/Azure (Priority is unavailable|Instant requires)/
			);
		}
	});

	describe('rejects contradictory Azure target structures', () => {
		testRejections([
			[
				'Anthropic model on an OpenAI route',
				(source: Source) => {
					asAzure(source);
					source.graph.authors.anthropic = { name: 'Anthropic' };
					source.graph.models['gpt-test'].authorId = 'anthropic';
				},
				'Azure Anthropic models and format must use only'
			],
			[
				'non-Anthropic model on the Anthropic route',
				(source: Source) => {
					asAzure(source);
					source.graph.routes['azure-anthropic-messages'] = {
						...source.graph.routes['azure-responses']
					};
					source.graph.deployments['azure-gpt-test'].routeIds = ['azure-anthropic-messages'];
				},
				'Azure Anthropic models and format must use only'
			],
			[
				'Anthropic model with a non-Anthropic format',
				(source: Source) => {
					asAzureClaude(source);
					source.graph.deployments['azure-gpt-test'].upstream.modelFormat = 'OpenAI';
					source.graph.deployments['azure-gpt-test'].upstream.hosting = 'azure';
				},
				'Azure Anthropic models and format must use only'
			],
			[
				'Anthropic model with an extra route',
				(source: Source) => {
					asAzureClaude(source);
					source.graph.routes['azure-responses'] = {
						...source.graph.routes['azure-anthropic-messages'],
						interfaces: ['responses']
					};
					source.graph.deployments['azure-gpt-test'].routeIds.push('azure-responses');
				},
				'Azure Anthropic models and format must use only'
			],
			[
				'Fireworks format hosted by Azure',
				(source: Source) => {
					asAzure(source);
					source.graph.deployments['azure-gpt-test'].upstream.modelFormat = 'Fireworks';
				},
				'Azure model format and hosting do not match'
			],
			[
				'OpenAI format hosted by NVIDIA',
				(source: Source) => {
					asAzure(source);
					source.graph.deployments['azure-gpt-test'].upstream.hosting = 'nvidia';
				},
				'Azure model format and hosting do not match'
			],
			[
				'NVIDIA format hosted by Azure',
				(source: Source) => {
					asAzure(source);
					source.graph.deployments['azure-gpt-test'].upstream.modelFormat = 'NVIDIA';
				},
				'Azure model format and hosting do not match'
			],
			[
				'Anthropic-hosted Data Zone',
				(source: Source) => {
					asAzureClaude(source);
					source.graph.deployments['azure-gpt-test'].upstream.deploymentType =
						'data_zone_standard_us';
				},
				'Anthropic-hosted Azure Claude is Global Standard only'
			],
			[
				'NVIDIA-hosted Data Zone',
				(source: Source) => {
					asAzure(source);
					source.graph.deployments['azure-gpt-test'].upstream.modelFormat = 'NVIDIA';
					source.graph.deployments['azure-gpt-test'].upstream.hosting = 'nvidia';
					source.graph.deployments['azure-gpt-test'].upstream.deploymentType =
						'data_zone_standard_us';
				},
				'this Azure hosting mode does not offer Data Zone Standard'
			],
			[
				'Fireworks target outside US Data Zone Chat Completions',
				(source: Source) => {
					asAzure(source);
					source.graph.deployments['azure-gpt-test'].upstream.modelFormat = 'Fireworks';
					source.graph.deployments['azure-gpt-test'].upstream.hosting = 'fireworks';
				},
				'Fireworks pay-per-token requires US Data Zone Chat Completions'
			],
			[
				'Azure US Data Zone with global handling',
				(source: Source) => {
					asAzure(source);
					source.graph.deployments['azure-gpt-test'].upstream.deploymentType =
						'data_zone_standard_us';
				},
				'Data Zone Standard must keep processing and storage in its declared location'
			],
			[
				'externally hosted target with disclosed locations',
				(source: Source) => {
					asAzureClaude(source);
					source.graph.deployments['azure-gpt-test'].overrides = {
						dataHandling: { processingLocation: 'US', storageLocation: 'US' }
					};
				},
				'externally hosted Azure locations must remain unknown or none'
			]
		]);

		test('allows externally hosted Azure content with no storage', () => {
			const source = changed((candidate) => {
				asAzureClaude(candidate);
				candidate.graph.deployments['azure-gpt-test'].overrides = {
					dataHandling: { processingLocation: 'unknown', storageLocation: 'none' }
				};
			});
			expect(
				buildCatalogs(source).runtime.graph.deployments['azure-gpt-test'].dataHandlingByRoute[
					'azure-anthropic-messages'
				]
			).toMatchObject({ processingLocation: 'unknown', storageLocation: 'none' });
		});
	});

	test('allows fixed reasoning mode for reviewed OpenAI Responses models without a name prefix', () => {
		const source = sourceFixture();
		source.graph.deployments['openai-gpt-test'].upstream.reasoningMode = 'pro';
		expect(buildCatalogs(source).runtime.graph.deployments['openai-gpt-test']).toBeDefined();

		expect(() =>
			buildCatalogs(
				changed((candidate) => {
					candidate.graph.authors.anthropic = { name: 'Anthropic' };
					candidate.graph.models['gpt-test'].authorId = 'anthropic';
					candidate.graph.deployments['openai-gpt-test'].upstream.reasoningMode = 'pro';
				})
			)
		).toThrow('fixed reasoning mode requires an OpenAI Responses model');
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

describe('route-owned native file formats', () => {
	const pdf = { extensions: ['.pdf'], mediaTypes: ['application/pdf'] };
	const text = { extensions: ['.txt'], mediaTypes: ['text/plain'] };
	const documents = { extensions: ['.pdf', '.txt'], mediaTypes: ['application/pdf', 'text/plain'] };

	test('keeps route formats distinct and lets a deployment replace all attached route formats', () => {
		const source = sourceFixture();
		source.graph.routes['openai-responses'].fileInputs = documents;
		addSecondOpenAIRoute(source);
		source.graph.routes['openai-chat-completions'].fileInputs = pdf;
		source.graph.deployments['openai-gpt-test'].routeIds.push('openai-chat-completions');
		const original = buildCatalogs(source);
		expect(original.runtime.graph.deployments['openai-gpt-test'].fileInputsByRoute).toEqual({
			'openai-chat-completions': pdf,
			'openai-responses': documents
		});
		source.graph.deployments['openai-gpt-test'].overrides = { fileInputs: pdf };
		const narrowed = buildCatalogs(source);
		expect(narrowed.runtime.graph.deployments['openai-gpt-test'].fileInputsByRoute).toEqual({
			'openai-chat-completions': pdf,
			'openai-responses': pdf
		});
		expect(
			narrowed.runtime.graph.deployments['openai-gpt-test'].chainHashes['openai-responses']
		).not.toBe(
			original.runtime.graph.deployments['openai-gpt-test'].chainHashes['openai-responses']
		);
		source.graph.deployments['openai-gpt-test'].overrides = { fileInputs: text };
		expect(
			buildCatalogs(source).runtime.graph.deployments['openai-gpt-test'].fileInputsByRoute
		).toEqual({
			'openai-chat-completions': text,
			'openai-responses': text
		});
		const added = { extensions: ['.md'], mediaTypes: ['text/markdown'] };
		source.graph.deployments['openai-gpt-test'].overrides = { fileInputs: added };
		expect(
			buildCatalogs(source).runtime.graph.deployments['openai-gpt-test'].fileInputsByRoute
		).toEqual({
			'openai-chat-completions': added,
			'openai-responses': added
		});
	});

	test('retains provider-processed PDFs for text-only models and deployment overrides', () => {
		const source = sourceFixture();
		source.graph.routes['openai-responses'].fileInputs = documents;
		source.graph.models['gpt-test'].inputModalities = ['text'];
		expect(
			buildCatalogs(source).runtime.graph.deployments['openai-gpt-test'].fileInputsByRoute
		).toEqual({
			'openai-responses': documents
		});
		source.graph.deployments['openai-gpt-test'].overrides = {
			fileInputs: { extensions: ['.md', '.pdf'], mediaTypes: ['application/pdf', 'text/markdown'] }
		};
		expect(
			buildCatalogs(source).runtime.graph.deployments['openai-gpt-test'].fileInputsByRoute
		).toEqual({
			'openai-responses': {
				extensions: ['.md', '.pdf'],
				mediaTypes: ['application/pdf', 'text/markdown']
			}
		});
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
		source.graph.routes['openai-responses'].fileInputs = formats;
		expect(() => buildCatalogs(source)).toThrow(/file/);
	});

	test('rejects a deployment format override that repeats its route', () => {
		const source = sourceFixture();
		source.graph.routes['openai-responses'].fileInputs = documents;
		source.graph.deployments['openai-gpt-test'].overrides = { fileInputs: documents };
		expect(() => buildCatalogs(source)).toThrow('redundantly');
	});
});
