import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import publicCatalog from '../generated/catalog.public.json';
import runtimeCatalog from '../generated/catalog.runtime.json';

const graphNodeTypes = ['authors', 'models', 'providers', 'routes', 'deployments'] as const;
const canonicalEffortOrder = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const canonicalEfforts = new Set(canonicalEffortOrder);
const reasoningAvailabilities = new Set(['unsupported', 'optional', 'required']);

describe('compiled catalog v2', () => {
	test('contains exactly the five useful graph primitives', () => {
		expect(Object.keys(publicCatalog.graph).sort()).toEqual([...graphNodeTypes].sort());
		expect(Object.keys(runtimeCatalog.graph).sort()).toEqual([...graphNodeTypes].sort());
		expect(
			Object.fromEntries(
				graphNodeTypes.map((nodeType) => [
					nodeType,
					Object.keys(publicCatalog.graph[nodeType]).length
				])
			)
		).toEqual({ authors: 10, models: 39, providers: 4, routes: 7, deployments: 114 });
		expect(JSON.stringify(publicCatalog)).not.toMatch(
			/providerOfferings|executionVariants|modelReleases|providerEndpoints|stogasEndpoints/
		);
	});

	test('binds runtime policy to the public ownership artifact', () => {
		const expected = `sha256:${createHash('sha256')
			.update(`${JSON.stringify(publicCatalog)}\n`)
			.digest('hex')}`;
		expect(runtimeCatalog.publicDigest).toBe(expected);
	});

	test('resolves every graph reference without semantic inference from IDs', () => {
		for (const [modelId, model] of Object.entries(publicCatalog.graph.models)) {
			expect(publicCatalog.graph.authors[model.authorId]).toBeDefined();
			expect(modelId).not.toBe('');
		}
		for (const [routeId, route] of Object.entries(publicCatalog.graph.routes)) {
			expect(publicCatalog.graph.providers[route.providerId]).toBeDefined();
			expect(route.interfaces.length).toBeGreaterThan(0);
			expect(routeId).not.toBe('');
		}
		for (const deployment of Object.values(runtimeCatalog.graph.deployments)) {
			expect(runtimeCatalog.graph.models[deployment.modelId]).toBeDefined();
			expect(deployment.routeIds.length).toBeGreaterThan(0);
			expect(deployment.upstream.model).not.toBe('');
			for (const routeId of deployment.routeIds) {
				expect(runtimeCatalog.graph.routes[routeId]).toBeDefined();
			}
		}
	});

	test('keeps Azure request selectors independent from canonical model IDs', () => {
		const selectors = Object.fromEntries(
			Object.entries(runtimeCatalog.graph.deployments)
				.filter(([, deployment]) =>
					deployment.routeIds.some((routeId) => routeId.startsWith('azure-'))
				)
				.map(([id, deployment]) => [id, deployment.upstream.model])
		);
		expect(Object.keys(selectors)).toHaveLength(53);
		expect(selectors).toMatchObject({
			'azure-claude-opus-5': 'claude-opus-5',
			'azure-claude-opus-5-anthropic-hosted': 'claude-opus-5',
			'azure-deepseek-v3.2': 'DeepSeek-V3.2',
			'azure-deepseek-v4-flash-0423-eu': 'DeepSeek-V4-Flash',
			'azure-deepseek-v4-pro': 'DeepSeek-V4-Pro',
			'azure-deepseek-v4-pro-fireworks': 'FW-DeepSeek-V4-Pro',
			'azure-glm-5.2': 'FW-GLM-5.2',
			'azure-gpt-5.6-luna-instant': 'gpt-5.6-luna',
			'azure-gpt-5.6-sol-fast': 'gpt-5.6-sol',
			'azure-gpt-5.6-sol-pro-fast': 'gpt-5.6-sol',
			'azure-gpt-5.6-terra-us': 'gpt-5.6-terra',
			'azure-gpt-oss-120b-us': 'gpt-oss-120b',
			'azure-minimax-m3': 'FW-MiniMax-M3'
		});
	});

	test('keeps aliases inline, selectors explicit, and globally unique', () => {
		const selectors = new Set<string>();
		for (const [modelId, model] of Object.entries(runtimeCatalog.graph.models)) {
			expect(model.aliases.length).toBeLessThanOrEqual(8);
			for (const selector of [modelId, ...model.aliases]) {
				expect(selector).not.toContain('/');
				expect(selectors.has(selector)).toBe(false);
				selectors.add(selector);
			}
		}
		for (const deployment of Object.values(runtimeCatalog.graph.deployments)) {
			expect(deployment.aliases.length).toBeLessThanOrEqual(8);
			for (const alias of deployment.aliases) {
				expect(alias).not.toBe(deployment.modelId);
				expect(alias).not.toContain('/');
				expect(selectors.has(alias)).toBe(false);
				selectors.add(alias);
			}
		}
		for (const deploymentId of Object.keys(runtimeCatalog.graph.deployments)) {
			expect(selectors.has(deploymentId)).toBe(false);
			selectors.add(deploymentId);
		}
		expect(selectors.size).toBeGreaterThan(50);
		expect(runtimeCatalog).not.toHaveProperty('aliases');
		expect(runtimeCatalog.graph.authors.openai.aliases).toEqual(['open-ai']);
		expect(runtimeCatalog.graph.providers.openai.aliases).toEqual(['open-ai']);
	});

	test('uses one nullable deprecation date and keeps history deterministic', () => {
		expect(
			publicCatalog.graph.deployments['openai-gpt-4o-search-preview-2025-03-11']
		).not.toHaveProperty('deprecationDate');
		expect(publicCatalog.graph.models['gpt-4o-search-preview-2025-03-11']).toMatchObject({
			deprecationDate: '2026-07-23'
		});
		expect(
			runtimeCatalog.graph.deployments['openai-gpt-4o-search-preview-2025-03-11']
		).toMatchObject({
			deprecationDate: '2026-07-23'
		});
		for (const deployment of Object.values(runtimeCatalog.graph.deployments)) {
			expect(deployment).toHaveProperty('deprecationDate');
			expect(deployment).not.toHaveProperty('status');
			expect(deployment).not.toHaveProperty('deprecatedAt');
			expect(deployment).not.toHaveProperty('retiredAt');
		}
		for (const model of Object.values(publicCatalog.graph.models)) {
			expect(model).toHaveProperty('deprecationDate');
		}
	});

	test('derives one canonical base deployment without a default flag', () => {
		for (const deployment of Object.values(runtimeCatalog.graph.deployments)) {
			expect(deployment).not.toHaveProperty('default');
		}
		for (const [routeId, route] of Object.entries(runtimeCatalog.graph.routes)) {
			const deployments = Object.entries(runtimeCatalog.graph.deployments).filter(
				([, deployment]) => deployment.routeIds.includes(routeId)
			);
			for (const modelId of new Set(deployments.map(([, deployment]) => deployment.modelId))) {
				const matchingIds = deployments
					.filter(([, deployment]) => deployment.modelId === modelId)
					.map(([deploymentId]) => deploymentId);
				if (matchingIds.length > 1) {
					expect(matchingIds).toContain(`${route.providerId}-${modelId}`);
				}
			}
		}
	});

	test('materializes runtime admission and billing facts', () => {
		for (const model of Object.values(publicCatalog.graph.models)) {
			expect(reasoningAvailabilities.has(model.reasoningAvailability)).toBe(true);
			expect(Array.isArray(model.reasoningEfforts)).toBe(true);
			expect(model).toHaveProperty('reasoningMaxTokens');
			expect(model.reasoningEfforts).toEqual(
				model.reasoningEfforts.toSorted(
					(left, right) => canonicalEffortOrder.indexOf(left) - canonicalEffortOrder.indexOf(right)
				)
			);
			if (model.reasoningMaxTokens) {
				expect(model.reasoningMaxTokens.minimum).toBeGreaterThan(0);
				expect(model.reasoningMaxTokens.maximum).toBeGreaterThanOrEqual(
					model.reasoningMaxTokens.minimum
				);
				expect(model.reasoningMaxTokens.maximum).toBeLessThan(model.maxOutputTokens);
			}
		}
		for (const deployment of Object.values(runtimeCatalog.graph.deployments)) {
			expect(reasoningAvailabilities.has(deployment.reasoningAvailability)).toBe(true);
			expect(deployment.contextWindowTokens).toBeGreaterThan(0);
			expect(deployment.maxOutputTokens).toBeGreaterThan(0);
			expect(deployment.maxOutputTokens).toBeLessThanOrEqual(deployment.contextWindowTokens);
			expect(deployment.inputModalities.length).toBeGreaterThan(0);
			expect(deployment.outputModalities.length).toBeGreaterThan(0);
			expect(deployment.capabilities).not.toHaveProperty('inputModalities');
			expect(deployment.capabilities).not.toHaveProperty('outputModalities');
			for (const effort of deployment.reasoningEfforts) {
				expect(canonicalEfforts.has(effort)).toBe(true);
			}
			expect(deployment.reasoningEfforts).toEqual(
				deployment.reasoningEfforts.toSorted(
					(left, right) => canonicalEffortOrder.indexOf(left) - canonicalEffortOrder.indexOf(right)
				)
			);
			expect(deployment).toHaveProperty('reasoningMaxTokens');
			if (deployment.reasoningMaxTokens) {
				expect(deployment.reasoningMaxTokens.minimum).toBeGreaterThan(0);
				expect(deployment.reasoningMaxTokens.maximum).toBeGreaterThanOrEqual(
					deployment.reasoningMaxTokens.minimum
				);
				expect(deployment.reasoningMaxTokens.maximum).toBeLessThan(deployment.maxOutputTokens);
			}
			expect(Object.keys(deployment.dataHandlingByRoute).sort()).toEqual(
				[...deployment.routeIds].sort()
			);
			for (const dataHandling of Object.values(deployment.dataHandlingByRoute)) {
				expect(dataHandling).toBeDefined();
			}
			expect(deployment).not.toHaveProperty('moderated');
			if (deployment.routeIds.includes('chutes-chat-completions')) {
				expect(deployment.upstream.gpuCount).toBeGreaterThanOrEqual(1);
				expect(deployment.upstream.gpuCount).toBeLessThanOrEqual(8);
			}
		}
	});

	test('keeps canonical reasoning facts separate from deployment limits', () => {
		expect(publicCatalog.graph.models['glm-5.2']).toMatchObject({
			reasoningAvailability: 'optional',
			reasoningEfforts: ['high', 'max'],
			reasoningMaxTokens: null
		});
		expect(runtimeCatalog.graph.deployments['chutes-glm-5.2']).toMatchObject({
			reasoningAvailability: 'optional',
			reasoningEfforts: ['high', 'max'],
			reasoningMaxTokens: null
		});
		expect(runtimeCatalog.graph.deployments['anthropic-claude-opus-4-6']).toMatchObject({
			reasoningMaxTokens: { maximum: 127999, minimum: 1024 }
		});
		expect(publicCatalog.graph.models['nemotron-3-nano-omni-30b']).toMatchObject({
			reasoningAvailability: 'optional',
			reasoningEfforts: [],
			reasoningMaxTokens: { maximum: 262143, minimum: 1 }
		});
		expect(runtimeCatalog.graph.deployments['chutes-nemotron-3-nano-omni-30b']).toMatchObject({
			reasoningAvailability: 'optional',
			reasoningEfforts: [],
			reasoningMaxTokens: null
		});
	});

	test('keeps author capabilities separate from reviewed Chutes serving limits', () => {
		expect(publicCatalog.graph.models['gemma-4-31b']).toMatchObject({
			inputModalities: ['text', 'image']
		});
		expect(runtimeCatalog.graph.deployments['chutes-gemma-4-31b-turbo']).toMatchObject({
			contextWindowTokens: 131072,
			inputModalities: ['text', 'image'],
			maxOutputTokens: 65536
		});
		expect(publicCatalog.graph.models['deepseek-v4-flash-0731']).toMatchObject({
			name: 'DeepSeek V4 Flash 0731',
			reasoningEfforts: ['low', 'high', 'max']
		});
		expect(runtimeCatalog.graph.deployments['chutes-deepseek-v4-flash-0731']).toMatchObject({
			reasoningEfforts: ['high', 'max']
		});
		for (const deploymentId of [
			'chutes-mistral-nemo-instruct-2407',
			'chutes-nemotron-3-nano-omni-30b'
		]) {
			expect(runtimeCatalog.graph.deployments[deploymentId].capabilities.structuredOutputs).toBe(
				true
			);
		}
		expect(publicCatalog.graph.models['mistral-nemo-instruct-2407']).toMatchObject({
			family: 'Mistral NeMo',
			knowledgeCutoff: '2024-04-01',
			name: 'Mistral NeMo Instruct 2407',
			series: 'Mistral NeMo'
		});
	});

	test('keeps public policy facts at their semantic owner', () => {
		for (const provider of Object.values(publicCatalog.graph.providers)) {
			expect(provider.dataHandling).toHaveProperty('processingLocation');
			expect(provider.dataHandling).toHaveProperty('storageLocation');
			expect(provider.dataHandling).toHaveProperty('tee');
			expect(typeof provider.dataHandling.trainingUse).toBe('boolean');
			expect(typeof provider.dataHandling.zeroDataRetention).toBe('boolean');
			expect(provider.dataHandling).not.toHaveProperty('endToEndEncrypted');
			expect(provider.dataHandling).not.toHaveProperty('gdpr');
		}
		for (const route of Object.values(publicCatalog.graph.routes)) {
			expect(typeof route.dataHandling.endToEndEncrypted).toBe('boolean');
			expect(route.dataHandling).not.toHaveProperty('processingLocation');
			expect(route.dataHandling).not.toHaveProperty('storageLocation');
		}
		expect(publicCatalog.graph.routes['anthropic-messages']).not.toHaveProperty('moderated');
		expect(publicCatalog.graph.deployments['chutes-qwen3-32b']).not.toHaveProperty('dataHandling');
		expect(publicCatalog.graph.deployments['chutes-qwen3-32b']).not.toHaveProperty('moderated');
		expect(
			publicCatalog.graph.deployments['chutes-nemotron-3-nano-omni-30b'].overrides
		).toMatchObject({ dataHandling: { tee: { externalNetworkEgress: 'allowed' } } });
		expect(publicCatalog).not.toHaveProperty('evidence');
		expect(JSON.stringify(publicCatalog)).not.toContain('"webSearch"');
	});

	test('publishes every known model release and only disclosed knowledge cutoffs', () => {
		for (const [modelId, model] of Object.entries(publicCatalog.graph.models)) {
			expect(model.releaseDate, `${modelId} releaseDate`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			expect(
				model.knowledgeCutoff === null || /^\d{4}-\d{2}-\d{2}$/.test(String(model.knowledgeCutoff)),
				`${modelId} knowledgeCutoff`
			).toBe(true);
		}
		expect(publicCatalog.graph.models['gemma-4-31b']).toMatchObject({
			knowledgeCutoff: '2025-01-01',
			releaseDate: '2026-03-31'
		});
	});

	test('keeps GPT-5.6 release dates separate from provider checkpoint selectors', () => {
		for (const tier of ['luna', 'sol', 'terra'] as const) {
			const modelId = `gpt-5.6-${tier}`;
			expect(publicCatalog.graph.models[modelId]).toMatchObject({
				releaseDate: '2026-07-09',
				snapshot: null
			});
			for (const deployment of Object.values(runtimeCatalog.graph.deployments)) {
				if (deployment.modelId !== modelId) continue;
				if (!deployment.routeIds.some((routeId) => routeId.startsWith('openai-'))) continue;
				expect(deployment.upstream.model).toBe(modelId);
			}
		}
		expect(runtimeCatalog.graph.deployments['openai-gpt-5.5-2026-04-23']).toMatchObject({
			upstream: { model: 'gpt-5.5-2026-04-23' }
		});
		expect(publicCatalog.graph.models['gpt-5.5-2026-04-23'].snapshot).toBe('2026-04-23');
	});

	test('keeps Anthropic selection literal and its guarantee normalized', () => {
		const deployment = runtimeCatalog.graph.deployments['anthropic-claude-opus-4-8-fast-us'];
		expect(deployment.routeIds).toEqual(['anthropic-messages']);
		expect(deployment.upstream).toEqual({
			inferenceGeo: 'us',
			model: 'claude-opus-4-8',
			speed: 'fast'
		});
		expect(
			publicCatalog.graph.deployments['anthropic-claude-opus-4-8-fast-us'].overrides.dataHandling
				.processingLocation
		).toBe('US');
	});

	test('enumerates current first-party Anthropic models and only supported variants', () => {
		const expectedActiveModels = [
			'claude-fable-5',
			'claude-haiku-4-5',
			'claude-opus-4-5',
			'claude-opus-4-6',
			'claude-opus-4-7',
			'claude-opus-4-8',
			'claude-opus-5',
			'claude-sonnet-4-5',
			'claude-sonnet-4-6',
			'claude-sonnet-5'
		];
		const activeModels = Object.entries(publicCatalog.graph.models)
			.filter(([, model]) => model.authorId === 'anthropic' && model.deprecationDate === null)
			.map(([modelId]) => modelId)
			.sort();
		expect(activeModels).toEqual(expectedActiveModels);
		expect(publicCatalog.graph.models['claude-fable-5'].reasoningEfforts).toEqual([
			'low',
			'medium',
			'high',
			'xhigh',
			'max'
		]);
		const baseDeploymentsByModel = new Map(
			Object.entries(runtimeCatalog.graph.deployments)
				.filter(([, deployment]) => deployment.routeIds.includes('anthropic-messages'))
				.map(([deploymentId, deployment]) => [deployment.modelId, deploymentId])
		);
		for (const modelId of expectedActiveModels)
			expect(baseDeploymentsByModel.has(modelId)).toBe(true);

		for (const [modelId, alias] of [
			['claude-haiku-4-5', 'claude-haiku-4.5'],
			['claude-opus-4-5', 'claude-opus-4.5'],
			['claude-opus-4-6', 'claude-opus-4.6'],
			['claude-opus-4-7', 'claude-opus-4.7'],
			['claude-opus-4-8', 'claude-opus-4.8'],
			['claude-sonnet-4-5', 'claude-sonnet-4.5'],
			['claude-sonnet-4-6', 'claude-sonnet-4.6']
		] as const) {
			expect(publicCatalog.graph.models[modelId].aliases).toContain(alias);
		}
		expect(publicCatalog.graph.deployments['anthropic-claude-haiku-4-5-20251001']).toMatchObject({
			aliases: [],
			modelId: 'claude-haiku-4-5',
			upstream: { model: 'claude-haiku-4-5-20251001' }
		});

		const geoModels = new Set([
			'claude-fable-5',
			'claude-opus-4-6',
			'claude-opus-4-7',
			'claude-opus-4-8',
			'claude-opus-5',
			'claude-sonnet-4-6',
			'claude-sonnet-5'
		]);
		const usModels = new Set(
			Object.values(runtimeCatalog.graph.deployments)
				.filter((deployment) => deployment.upstream.inferenceGeo === 'us')
				.map((deployment) => deployment.modelId)
		);
		expect(usModels).toEqual(geoModels);
		for (const deployment of Object.values(runtimeCatalog.graph.deployments)) {
			if (!deployment.routeIds.includes('anthropic-messages')) continue;
			if (!geoModels.has(deployment.modelId)) {
				expect(deployment.upstream).not.toHaveProperty('inferenceGeo');
			}
		}

		const fastModels = new Set(
			Object.values(runtimeCatalog.graph.deployments)
				.filter((deployment) => deployment.upstream.speed === 'fast')
				.map((deployment) => deployment.modelId)
		);
		expect(fastModels).toEqual(new Set(['claude-opus-4-8', 'claude-opus-5']));
		expect(publicCatalog.graph.models['claude-opus-4-1']).toMatchObject({
			aliases: ['claude-opus-4.1'],
			deprecationDate: '2026-08-05',
			maxOutputTokens: 32000
		});
		expect(publicCatalog.graph.routes['anthropic-messages'].dataHandling).toEqual({
			endToEndEncrypted: false
		});
		expect(publicCatalog.graph.providers.anthropic.pricing).toEqual({
			anthropic_web_search_calls: {
				per_1k_calls: '10000000000000000000'
			}
		});
		expect(publicCatalog.graph.routes['anthropic-messages']).not.toHaveProperty('pricing');
		expect(runtimeCatalog.graph.deployments['anthropic-claude-opus-5'].pricing).toHaveProperty(
			'anthropic_web_search_calls'
		);
	});

	test('publishes OpenAI Fast naming and current GPT-5.6 prices', () => {
		const deployments = runtimeCatalog.graph.deployments;
		expect(publicCatalog.graph.models['gpt-5-search-api-2025-10-14']).toMatchObject({
			capabilities: {
				functionCalling: false,
				parallelFunctionCalling: false
			},
			contextWindowTokens: 400_000,
			maxOutputTokens: 128_000
		});
		for (const fastId of [
			'openai-gpt-5.5-2026-04-23-fast',
			'openai-gpt-5.6-luna-fast',
			'openai-gpt-5.6-sol-fast',
			'openai-gpt-5.6-terra-fast'
		] as const) {
			expect(deployments[fastId]).toMatchObject({
				upstream: { serviceTier: 'priority' }
			});
		}
		for (const retiredId of [
			'openai-gpt-5.5-2026-04-23-priority',
			'openai-gpt-5.6-luna-priority',
			'openai-gpt-5.6-sol-priority',
			'openai-gpt-5.6-terra-priority'
		]) {
			expect(Object.keys(deployments)).not.toContain(retiredId);
		}
		for (const [fastId, priorityAlias] of [
			['openai-gpt-5.5-2026-04-23-fast', 'gpt-5.5-priority'],
			['openai-gpt-5.6-luna-fast', 'gpt-5.6-luna-priority'],
			['openai-gpt-5.6-sol-fast', 'gpt-5.6-priority'],
			['openai-gpt-5.6-terra-fast', 'gpt-5.6-terra-priority']
		] as const) {
			expect(deployments[fastId].aliases).toContain(priorityAlias);
		}

		expect(deployments['openai-gpt-5.6-luna'].pricing).toMatchObject({
			input_tokens: {
				per_mill_context_lte_272k: '200000000000000000',
				per_mill_context_gt_272k: '400000000000000000'
			},
			cached_input_tokens: {
				per_mill_context_lte_272k: '20000000000000000',
				per_mill_context_gt_272k: '40000000000000000'
			},
			cache_write_input_tokens: {
				per_mill_context_lte_272k: '250000000000000000',
				per_mill_context_gt_272k: '500000000000000000'
			},
			output_tokens: {
				per_mill_context_lte_272k: '1200000000000000000',
				per_mill_context_gt_272k: '1800000000000000000'
			}
		});
		expect(deployments['openai-gpt-5.6-luna-flex'].pricing).toMatchObject({
			input_tokens: {
				per_mill_context_lte_272k: '100000000000000000',
				per_mill_context_gt_272k: '200000000000000000'
			},
			cached_input_tokens: {
				per_mill_context_lte_272k: '10000000000000000',
				per_mill_context_gt_272k: '20000000000000000'
			},
			cache_write_input_tokens: {
				per_mill_context_lte_272k: '125000000000000000',
				per_mill_context_gt_272k: '250000000000000000'
			},
			output_tokens: {
				per_mill_context_lte_272k: '600000000000000000',
				per_mill_context_gt_272k: '900000000000000000'
			}
		});
		expect(deployments['openai-gpt-5.6-luna-fast'].pricing).toMatchObject({
			input_tokens: {
				per_mill_context_lte_272k: '400000000000000000',
				per_mill_context_gt_272k: '800000000000000000'
			},
			cached_input_tokens: {
				per_mill_context_lte_272k: '40000000000000000',
				per_mill_context_gt_272k: '80000000000000000'
			},
			cache_write_input_tokens: {
				per_mill_context_lte_272k: '500000000000000000',
				per_mill_context_gt_272k: '1000000000000000000'
			},
			output_tokens: {
				per_mill_context_lte_272k: '2400000000000000000',
				per_mill_context_gt_272k: '3600000000000000000'
			}
		});
		expect(deployments['openai-gpt-5.6-luna-fast'].contextWindowTokens).toBe(1_050_000);

		expect(deployments['openai-gpt-5.6-sol-fast'].pricing).toMatchObject({
			input_tokens: {
				per_mill_context_lte_272k: '10000000000000000000',
				per_mill_context_gt_272k: '20000000000000000000'
			},
			cached_input_tokens: {
				per_mill_context_lte_272k: '1000000000000000000',
				per_mill_context_gt_272k: '2000000000000000000'
			},
			cache_write_input_tokens: {
				per_mill_context_lte_272k: '12500000000000000000',
				per_mill_context_gt_272k: '25000000000000000000'
			},
			output_tokens: {
				per_mill_context_lte_272k: '60000000000000000000',
				per_mill_context_gt_272k: '90000000000000000000'
			}
		});
		expect(deployments['openai-gpt-5.6-sol-fast'].contextWindowTokens).toBe(1_050_000);

		expect(deployments['openai-gpt-5.6-terra'].pricing).toMatchObject({
			input_tokens: {
				per_mill_context_lte_272k: '2000000000000000000',
				per_mill_context_gt_272k: '4000000000000000000'
			},
			cached_input_tokens: {
				per_mill_context_lte_272k: '200000000000000000',
				per_mill_context_gt_272k: '400000000000000000'
			},
			cache_write_input_tokens: {
				per_mill_context_lte_272k: '2500000000000000000',
				per_mill_context_gt_272k: '5000000000000000000'
			},
			output_tokens: {
				per_mill_context_lte_272k: '12000000000000000000',
				per_mill_context_gt_272k: '18000000000000000000'
			}
		});
		expect(deployments['openai-gpt-5.6-terra-flex'].pricing).toMatchObject({
			input_tokens: {
				per_mill_context_lte_272k: '1000000000000000000',
				per_mill_context_gt_272k: '2000000000000000000'
			},
			cached_input_tokens: {
				per_mill_context_lte_272k: '100000000000000000',
				per_mill_context_gt_272k: '200000000000000000'
			},
			cache_write_input_tokens: {
				per_mill_context_lte_272k: '1250000000000000000',
				per_mill_context_gt_272k: '2500000000000000000'
			},
			output_tokens: {
				per_mill_context_lte_272k: '6000000000000000000',
				per_mill_context_gt_272k: '9000000000000000000'
			}
		});
		expect(deployments['openai-gpt-5.6-terra-fast'].pricing).toMatchObject({
			input_tokens: {
				per_mill_context_lte_272k: '4000000000000000000',
				per_mill_context_gt_272k: '8000000000000000000'
			},
			cached_input_tokens: {
				per_mill_context_lte_272k: '400000000000000000',
				per_mill_context_gt_272k: '800000000000000000'
			},
			cache_write_input_tokens: {
				per_mill_context_lte_272k: '5000000000000000000',
				per_mill_context_gt_272k: '10000000000000000000'
			},
			output_tokens: {
				per_mill_context_lte_272k: '24000000000000000000',
				per_mill_context_gt_272k: '36000000000000000000'
			}
		});
		expect(deployments['openai-gpt-5.6-terra-fast'].contextWindowTokens).toBe(1_050_000);
	});

	test('publishes every GPT-5.6 Pro service tier as a Responses-only selector', () => {
		const deployments = runtimeCatalog.graph.deployments;
		for (const [modelTier, baseAliases] of [
			['sol', ['gpt-5.6-pro', 'gpt-5.6-sol-pro']],
			['terra', ['gpt-5.6-terra-pro']],
			['luna', ['gpt-5.6-luna-pro']]
		] as const) {
			for (const [selectorSuffix, peerSuffix, serviceTier] of [
				['', '', 'default'],
				['-flex', '-flex', 'flex'],
				['-fast', '-fast', 'priority']
			] as const) {
				const deploymentId = `openai-gpt-5.6-${modelTier}-pro${selectorSuffix}`;
				const peer = deployments[`openai-gpt-5.6-${modelTier}${peerSuffix}`];
				const aliases = baseAliases.flatMap((alias) =>
					selectorSuffix === '-fast'
						? [`${alias}-fast`, `${alias}-priority`]
						: [`${alias}${selectorSuffix}`]
				);
				const pro = deployments[deploymentId];
				expect(pro).toMatchObject({
					aliases,
					modelId: `gpt-5.6-${modelTier}`,
					routeIds: ['openai-responses'],
					upstream: {
						model: `gpt-5.6-${modelTier}`,
						reasoningMode: 'pro',
						serviceTier
					}
				});
				expect(pro.pricing).toEqual(peer.pricing);
				expect(pro.contextWindowTokens).toBe(peer.contextWindowTokens);
				expect(publicCatalog.graph.deployments[deploymentId]).toBeDefined();
			}
		}
	});

	test('keeps deterministic runtime and public artifacts within defensive limits', () => {
		expect(Bun.file('generated/catalog.runtime.json').size).toBeLessThanOrEqual(16 * 1024 * 1024);
		expect(Bun.file('generated/catalog.public.json').size).toBeLessThanOrEqual(64 * 1024 * 1024);
		expect(runtimeCatalog.schema).toBe('stogas.catalog.runtime.v2');
		expect(publicCatalog.schema).toBe('stogas.catalog.public.v2');
	});
});
