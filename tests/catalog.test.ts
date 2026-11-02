import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
	CATALOG_LIMIT,
	CATALOG_PART_LIMIT,
	CATALOG_ROOT_LIMIT
} from '../source/scripts/catalog-files.mjs';
import { ancestorGroupIds } from '../source/scripts/model-groups.mjs';
import { placeIndex } from '../source/scripts/locations.mjs';
import { catalog, catalogRoot } from './generated-catalog';

const graphNodeTypes = ['authors', 'models', 'providers', 'routes', 'deployments'] as const;
const rootBytes = readFileSync('generated/catalog.json');
const partBytes = (sha256: string) => readFileSync(`generated/catalog.parts/${sha256}.json`);
const canonicalEffortOrder = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const canonicalEfforts = new Set(canonicalEffortOrder);
const reasoningValues = new Set(['unsupported', 'optional', 'required']);
// Exact decimal price scaled to an integer.
const coefficient = (value: string) => {
	const [whole, fraction = ''] = value.split('.');
	return BigInt(whole! + fraction.padEnd(36, '0'));
};

describe('compiled catalog', () => {
	test('holds every kind of record in one graph, which the root summarizes', () => {
		expect(Object.keys(catalog.graph).sort()).toEqual([...graphNodeTypes, 'groups'].sort());
		for (const [kind, records] of Object.entries(catalog.graph))
			expect(
				Object.keys(catalogRoot.summaries[kind as keyof typeof catalogRoot.summaries])
			).toEqual(Object.keys(records));
		expect(
			Object.fromEntries(
				graphNodeTypes.map((nodeType) => [nodeType, Object.keys(catalog.graph[nodeType]).length])
			)
		).toEqual({ authors: 10, models: 46, providers: 6, routes: 9, deployments: 230 });
		expect(JSON.stringify(catalog)).not.toMatch(
			/providerOfferings|executionVariants|modelReleases|providerEndpoints|stogasEndpoints/
		);
	});

	test('names every part by its SHA-256 and size, within the limits', () => {
		expect(rootBytes.byteLength).toBeLessThanOrEqual(CATALOG_ROOT_LIMIT);
		let total = rootBytes.byteLength;
		for (const { sha256, size } of catalogRoot.parts) {
			const bytes = partBytes(sha256);
			expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha256);
			expect(bytes.byteLength).toBe(size);
			expect(size).toBeLessThanOrEqual(CATALOG_PART_LIMIT);
			total += size;
		}
		expect(total).toBeLessThanOrEqual(CATALOG_LIMIT);
	});

	test('resolves every graph reference without semantic inference from IDs', () => {
		for (const [modelId, model] of Object.entries(catalog.graph.models)) {
			expect(catalog.graph.authors[model.authorId]).toBeDefined();
			expect(modelId).not.toBe('');
		}
		for (const [routeId, route] of Object.entries(catalog.graph.routes)) {
			expect(catalog.graph.providers[route.providerId]).toBeDefined();
			expect(route.interfaces.length).toBeGreaterThan(0);
			expect(routeId).not.toBe('');
		}
		for (const deployment of Object.values(catalog.graph.deployments)) {
			expect(catalog.graph.models[deployment.modelId]).toBeDefined();
			expect(Object.keys(deployment.routes).length).toBeGreaterThan(0);
			expect(deployment.upstream.model).not.toBe('');
			for (const routeId of Object.keys(deployment.routes)) {
				expect(catalog.graph.routes[routeId]).toBeDefined();
			}
		}
	});

	test('keeps Azure request selectors independent from canonical model IDs', () => {
		const selectors = Object.fromEntries(
			Object.entries(catalog.graph.deployments)
				.filter(([, deployment]) =>
					Object.keys(deployment.routes).some((routeId) => routeId.startsWith('azure-'))
				)
				.map(([id, deployment]) => [id, deployment.upstream.model])
		);
		expect(Object.keys(selectors)).toHaveLength(126);
		expect(selectors).toMatchObject({
			'azure-claude-opus-5-5': 'claude-opus-5-5',
			'azure-claude-opus-5-5-anthropic-hosted': 'claude-opus-5-5',
			'azure-deepseek-v4-flash-0423-eu': 'DeepSeek-V4-Flash',
			'azure-deepseek-v4-pro': 'DeepSeek-V4-Pro',
			'azure-deepseek-v4-pro-fireworks-hosted-us': 'FW-DeepSeek-V4-Pro',
			'azure-glm-5.2': 'FW-GLM-5.2',
			'azure-gpt-5.6-luna-instant': 'gpt-5.6-luna',
			'azure-gpt-5.6-sol-fast': 'gpt-5.6-sol',
			'azure-gpt-5.6-sol-pro-fast': 'gpt-5.6-sol',
			'azure-gpt-5.6-terra-us': 'gpt-5.6-terra',
			'azure-gpt-6-astra-pro-flex': 'gpt-6-astra',
			'azure-gpt-6-sol-pro-fast-us': 'gpt-6-sol',
			'azure-gpt-oss-120b-us': 'gpt-oss-120b',
			'azure-minimax-m3': 'FW-MiniMax-M3'
		});
	});

	test('keeps aliases to respellings and selectors globally unique', () => {
		const selectors = new Set<string>();
		for (const [modelId, model] of Object.entries(catalog.graph.models)) {
			for (const alias of model.aliases) {
				expect(alias.replaceAll('.', '-')).toBe(modelId.replaceAll('.', '-'));
			}
			for (const selector of [modelId, ...model.aliases]) {
				expect(selector).not.toContain('/');
				expect(selectors.has(selector)).toBe(false);
				selectors.add(selector);
			}
		}
		const groupIds = new Set(
			Object.values(catalog.graph.models).flatMap((model) =>
				ancestorGroupIds(catalog.graph.groups, model.groupIds)
			)
		);
		for (const selector of [...Object.keys(catalog.graph.deployments), ...groupIds]) {
			expect(selectors.has(selector)).toBe(false);
			selectors.add(selector);
		}
		expect(catalog.graph.models['claude-haiku-4-5'].aliases).toEqual(['claude-haiku-4.5']);
		expect(selectors.has('claude-haiku-latest')).toBe(false);
		// A model names its own groups, and readers add their ancestors.
		expect(catalog.graph.models['claude-haiku-4-5'].groupIds).toEqual(['claude-haiku']);
		expect(
			ancestorGroupIds(catalog.graph.groups, catalog.graph.models['claude-haiku-4-5'].groupIds)
		).toEqual(['claude', 'claude-haiku']);
		expect(selectors.size).toBeGreaterThan(50);
		expect(catalog).not.toHaveProperty('aliases');
		expect(catalog.graph.authors.openai.aliases).toEqual(['open-ai']);
		expect(catalog.graph.providers.openai.aliases).toEqual(['open-ai']);
	});

	test('excludes confirmed shutdowns through the pre-launch cutoff without retiring other providers', () => {
		expect(catalog.graph.deployments['anthropic-claude-haiku-4-5-20251001']).toBeDefined();
		expect(
			catalog.graph.deployments['anthropic-claude-opus-4-5-20251101'].retirementDate
		).toBeNull();
		expect(catalog.graph.deployments['azure-claude-haiku-4-5']).toBeUndefined();
		expect(catalog.graph.deployments['azure-claude-haiku-4-5-anthropic-hosted']).toBeUndefined();
		for (const modelId of [
			'gpt-5-nano-2025-08-07',
			'claude-sonnet-4-5',
			'claude-opus-4-1',
			'gpt-4o-mini-search-preview-2025-03-11',
			'gpt-4o-search-preview-2025-03-11'
		]) {
			expect(catalog.graph.models).not.toHaveProperty(modelId);
			expect(
				Object.values(catalog.graph.deployments).some(
					(deployment) => deployment.modelId === modelId
				)
			).toBe(false);
		}
		for (const deployment of Object.values(catalog.graph.deployments)) {
			expect(deployment).toHaveProperty('retirementDate');
			if (deployment.retirementDate !== null)
				expect(deployment.retirementDate > '2026-12-31').toBe(true);
		}
	});

	test('derives one canonical base deployment without a default flag', () => {
		for (const deployment of Object.values(catalog.graph.deployments)) {
			expect(deployment).not.toHaveProperty('default');
		}
		for (const [routeId, route] of Object.entries(catalog.graph.routes)) {
			const deployments = Object.entries(catalog.graph.deployments).filter(([, deployment]) =>
				Object.hasOwn(deployment.routes, routeId)
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
		for (const model of Object.values(catalog.graph.models)) {
			expect(reasoningValues.has(model.reasoning)).toBe(true);
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
		for (const deployment of Object.values(catalog.graph.deployments)) {
			expect(reasoningValues.has(deployment.reasoning)).toBe(true);
			expect(deployment.contextWindowTokens).toBeGreaterThan(0);
			expect(deployment.maxInputTokens).toBeGreaterThan(0);
			expect(deployment.maxInputTokens).toBeLessThanOrEqual(deployment.contextWindowTokens);
			expect(deployment.maxOutputTokens).toBeGreaterThan(0);
			expect(deployment.maxOutputTokens).toBeLessThanOrEqual(deployment.contextWindowTokens);
			expect(deployment.outputModalities.length).toBeGreaterThan(0);
			for (const route of Object.values(deployment.routes)) {
				expect(route.inputModalities[0]).toBe('text');
				for (const effort of route.reasoningEfforts) {
					expect(canonicalEfforts.has(effort)).toBe(true);
				}
				expect(route.reasoningEfforts).toEqual(
					route.reasoningEfforts.toSorted(
						(left, right) =>
							canonicalEffortOrder.indexOf(left) - canonicalEffortOrder.indexOf(right)
					)
				);
				expect(route.chainHash).toMatch(/^sha256:[0-9a-f]{64}$/);
			}
			expect(deployment).toHaveProperty('reasoningMaxTokens');
			if (deployment.reasoningMaxTokens) {
				expect(deployment.reasoningMaxTokens.minimum).toBeGreaterThan(0);
				expect(deployment.reasoningMaxTokens.maximum).toBeGreaterThanOrEqual(
					deployment.reasoningMaxTokens.minimum
				);
				expect(deployment.reasoningMaxTokens.maximum).toBeLessThan(deployment.maxOutputTokens);
			}
			if (Object.hasOwn(deployment.routes, 'chutes-chat-completions')) {
				expect(deployment.upstream.gpuCount).toBeGreaterThanOrEqual(1);
				expect(deployment.upstream.gpuCount).toBeLessThanOrEqual(8);
			}
		}
	});

	test('keeps canonical reasoning facts separate from deployment limits', () => {
		expect(catalog.graph.models['glm-5.2']).toMatchObject({
			reasoning: 'optional',
			reasoningEfforts: ['high', 'max'],
			reasoningMaxTokens: null
		});
		expect(catalog.graph.deployments['chutes-glm-5.2']).toMatchObject({
			reasoning: 'optional',
			reasoningMaxTokens: null,
			routes: { 'chutes-chat-completions': { reasoningEfforts: ['high', 'max'] } }
		});
		expect(catalog.graph.deployments['anthropic-claude-opus-4-6']).toMatchObject({
			reasoningMaxTokens: { maximum: 127999, minimum: 1024 }
		});
		expect(catalog.graph.models['nemotron-3-nano-omni-30b']).toMatchObject({
			reasoning: 'optional',
			reasoningEfforts: [],
			reasoningMaxTokens: { maximum: 262143, minimum: 1 }
		});
	});

	test('keeps author capabilities separate from reviewed Chutes serving limits', () => {
		expect(catalog.graph.models['gemma-4-26b-a4b']).toMatchObject({
			inputModalities: ['text', 'image', 'video'],
			reasoning: 'optional',
			reasoningEfforts: []
		});
		expect(catalog.graph.models['gemma-4-31b']).toMatchObject({
			inputModalities: ['text', 'image', 'video'],
			reasoningEfforts: []
		});
		// The Chutes route carries only text, whatever the model accepts.
		expect(catalog.graph.deployments['chutes-gemma-4-31b-turbo']).toMatchObject({
			contextWindowTokens: 131072,
			maxOutputTokens: 65536,
			routes: { 'chutes-chat-completions': { inputModalities: ['text'] } }
		});
		expect(catalog.graph.models['deepseek-v4-flash-0731']).toMatchObject({
			name: 'DeepSeek V4 Flash 0731',
			reasoningEfforts: ['low', 'high', 'max']
		});
		expect(catalog.graph.deployments['chutes-deepseek-v4-flash-0731']).toMatchObject({
			routes: { 'chutes-chat-completions': { reasoningEfforts: ['high', 'max'] } }
		});
		expect(catalog.graph.models['mistral-nemo-instruct-2407']).toMatchObject({
			groupIds: ['mistral-nemo'],
			knowledgeCutoff: '2024-04-01',
			name: 'Mistral NeMo Instruct 2407'
		});
		for (const [modelId, contextWindowTokens] of [
			['qwen3-32b', 131_072],
			['qwen3.5-397b-a17b', 1_010_000],
			['qwen3.6-27b', 1_010_000],
			['qwen3.8-27b', 1_000_000]
		] as const) {
			expect(catalog.graph.models[modelId]).toMatchObject({
				contextWindowTokens,
				maxOutputTokens: contextWindowTokens
			});
		}
		for (const deploymentId of [
			'chutes-qwen3.5-397b-a17b',
			'chutes-qwen3.6-27b',
			'chutes-qwen3.8-27b'
		]) {
			expect(catalog.graph.deployments[deploymentId]).toMatchObject({
				contextWindowTokens: 262_144,
				maxOutputTokens: 65_536
			});
		}
		for (const modelId of ['nemotron-3-super', 'nemotron-3-ultra']) {
			expect(catalog.graph.models[modelId]).toMatchObject({
				reasoning: 'optional',
				reasoningEfforts: []
			});
		}
		expect(catalog.graph.models['gpt-oss-120b'].knowledgeCutoff).toBe('2024-06-01');
	});

	test('resolves public policy facts on routes and deployment routes', () => {
		// Provider defaults are compiled into routes, so readers never combine nodes.
		for (const provider of Object.values(catalog.graph.providers)) {
			expect(provider).not.toHaveProperty('capabilities');
			expect(provider).not.toHaveProperty('dataHandling');
		}
		const dataHandlingFields = [
			'endToEndEncrypted',
			'processingLocation',
			'retentionDays',
			'storageLocation',
			'tee',
			'teeVerified',
			'trainingUse',
			'zeroDataRetention'
		];
		const records = [
			...Object.values(catalog.graph.routes),
			...Object.values(catalog.graph.deployments).flatMap((deployment) =>
				Object.values(deployment.routes)
			)
		];
		for (const { dataHandling } of records) {
			expect(Object.keys(dataHandling).sort()).toEqual(dataHandlingFields);
			expect(dataHandling.teeVerified && !dataHandling.tee).toBe(false);
		}
		expect(catalog.graph.deployments['chutes-qwen3.6-27b']).not.toHaveProperty('dataHandling');
		expect(catalog.graph.deployments['chutes-qwen3.6-27b']).not.toHaveProperty('overrides');
		expect(catalog).not.toHaveProperty('evidence');
	});

	test('publishes every known model release and only disclosed knowledge cutoffs', () => {
		for (const [modelId, model] of Object.entries(catalog.graph.models)) {
			expect(model.releaseDate, `${modelId} releaseDate`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			expect(
				model.knowledgeCutoff === null || /^\d{4}-\d{2}-\d{2}$/.test(String(model.knowledgeCutoff)),
				`${modelId} knowledgeCutoff`
			).toBe(true);
		}
		expect(catalog.graph.models['gemma-4-31b']).toMatchObject({
			knowledgeCutoff: '2025-01-01',
			releaseDate: '2026-03-31'
		});
	});

	test('keeps GPT-5.6 release dates separate from provider checkpoint selectors', () => {
		for (const tier of ['luna', 'sol', 'terra'] as const) {
			const modelId = `gpt-5.6-${tier}`;
			expect(catalog.graph.models[modelId]).toMatchObject({
				releaseDate: '2026-07-09',
				snapshot: null
			});
			for (const deployment of Object.values(catalog.graph.deployments)) {
				if (deployment.modelId !== modelId) continue;
				if (!Object.keys(deployment.routes).some((routeId) => routeId.startsWith('openai-')))
					continue;
				expect(deployment.upstream.model).toBe(modelId);
			}
		}
		expect(catalog.graph.deployments['openai-gpt-5.5-2026-04-23']).toMatchObject({
			upstream: { model: 'gpt-5.5-2026-04-23' }
		});
		expect(catalog.graph.models['gpt-5.5-2026-04-23'].snapshot).toBe('2026-04-23');
	});

	test('keeps Anthropic selection literal and its guarantee normalized', () => {
		const deployment = catalog.graph.deployments['anthropic-claude-opus-5-5-fast-us'];
		expect(Object.keys(deployment.routes)).toEqual(['anthropic-messages']);
		expect(deployment.upstream).toEqual({
			inferenceGeo: 'us',
			model: 'claude-opus-5-5',
			serviceTier: 'fast'
		});
		expect(
			catalog.graph.deployments['anthropic-claude-opus-5-5-fast-us'].routes['anthropic-messages']
				.dataHandling.processingLocation
		).toBe('US');
	});

	test('enumerates current first-party Anthropic models and only supported variants', () => {
		const expectedActiveModels = [
			'claude-fable-5',
			'claude-fable-5-1',
			'claude-haiku-4-5',
			'claude-haiku-5-5',
			'claude-mythos-5',
			'claude-mythos-5-1',
			'claude-opus-4-5',
			'claude-opus-4-6',
			'claude-opus-4-7',
			'claude-opus-4-8',
			'claude-opus-5',
			'claude-opus-5-5',
			'claude-sonnet-4-6',
			'claude-sonnet-5',
			'claude-sonnet-5-5'
		];
		const activeModels = Object.entries(catalog.graph.models)
			.filter(
				([modelId, model]) =>
					model.authorId === 'anthropic' &&
					Object.values(catalog.graph.deployments).some(
						(deployment) =>
							deployment.modelId === modelId &&
							Object.hasOwn(deployment.routes, 'anthropic-messages') &&
							deployment.retirementDate === null
					)
			)
			.map(([modelId]) => modelId)
			.sort();
		expect(activeModels).toEqual(expectedActiveModels);
		expect(catalog.graph.models['claude-fable-5'].reasoningEfforts).toEqual([
			'low',
			'medium',
			'high',
			'xhigh',
			'max'
		]);
		const baseDeploymentsByModel = new Map(
			Object.entries(catalog.graph.deployments)
				.filter(([, deployment]) => Object.hasOwn(deployment.routes, 'anthropic-messages'))
				.map(([deploymentId, deployment]) => [deployment.modelId, deploymentId])
		);
		for (const modelId of expectedActiveModels)
			expect(baseDeploymentsByModel.has(modelId)).toBe(true);

		for (const [modelId, alias] of [
			['claude-fable-5-1', 'claude-fable-5.1'],
			['claude-haiku-4-5', 'claude-haiku-4.5'],
			['claude-haiku-5-5', 'claude-haiku-5.5'],
			['claude-mythos-5-1', 'claude-mythos-5.1'],
			['claude-opus-4-5', 'claude-opus-4.5'],
			['claude-opus-4-6', 'claude-opus-4.6'],
			['claude-opus-4-7', 'claude-opus-4.7'],
			['claude-opus-4-8', 'claude-opus-4.8'],
			['claude-opus-5-5', 'claude-opus-5.5'],
			['claude-sonnet-4-6', 'claude-sonnet-4.6'],
			['claude-sonnet-5-5', 'claude-sonnet-5.5']
		] as const) {
			expect(catalog.graph.models[modelId].aliases).toContain(alias);
		}
		expect(catalog.graph.deployments['anthropic-claude-haiku-4-5-20251001']).toMatchObject({
			modelId: 'claude-haiku-4-5',
			upstream: { model: 'claude-haiku-4-5-20251001' }
		});

		const geoModels = new Set([
			'claude-fable-5',
			'claude-fable-5-1',
			'claude-haiku-5-5',
			'claude-mythos-5',
			'claude-mythos-5-1',
			'claude-opus-4-6',
			'claude-opus-4-7',
			'claude-opus-4-8',
			'claude-opus-5',
			'claude-opus-5-5',
			'claude-sonnet-4-6',
			'claude-sonnet-5',
			'claude-sonnet-5-5'
		]);
		const usModels = new Set(
			Object.values(catalog.graph.deployments)
				.filter((deployment) => deployment.upstream.inferenceGeo === 'us')
				.map((deployment) => deployment.modelId)
		);
		expect(usModels).toEqual(geoModels);
		for (const deployment of Object.values(catalog.graph.deployments)) {
			if (!Object.hasOwn(deployment.routes, 'anthropic-messages')) continue;
			if (!geoModels.has(deployment.modelId)) {
				expect(deployment.upstream).not.toHaveProperty('inferenceGeo');
			}
		}

		const fastModels = new Set(
			Object.values(catalog.graph.deployments)
				.filter(
					(deployment) =>
						Object.hasOwn(deployment.routes, 'anthropic-messages') &&
						deployment.upstream.serviceTier === 'fast'
				)
				.map((deployment) => deployment.modelId)
		);
		expect(fastModels).toEqual(new Set(['claude-opus-5', 'claude-opus-5-5']));
		expect(catalog.graph.routes['anthropic-messages'].dataHandling).toMatchObject({
			endToEndEncrypted: false,
			storageLocation: 'none',
			retentionDays: 0,
			zeroDataRetention: false
		});
		expect(catalog.graph.routes['anthropic-messages'].pricing).toEqual({
			anthropic_web_search_calls: {
				per_1k_calls: '10'
			}
		});
		expect(
			catalog.graph.deployments['anthropic-claude-opus-5'].routes['anthropic-messages'].pricing
		).toHaveProperty('anthropic_web_search_calls');
		for (const deploymentId of [
			'anthropic-claude-fable-5',
			'anthropic-claude-fable-5-us',
			'anthropic-claude-fable-5-1',
			'anthropic-claude-fable-5-1-us',
			'anthropic-claude-mythos-5',
			'anthropic-claude-mythos-5-us',
			'anthropic-claude-mythos-5-1',
			'anthropic-claude-mythos-5-1-us'
		]) {
			expect(catalog.graph.deployments[deploymentId].routes).toEqual({
				'anthropic-messages': expect.objectContaining({
					dataHandling: expect.objectContaining({ storageLocation: 'unknown', retentionDays: 30 })
				})
			});
		}
		expect(
			catalog.graph.deployments['anthropic-claude-opus-5'].routes['anthropic-messages'].dataHandling
		).toMatchObject({ storageLocation: 'none', retentionDays: 0 });
	});

	test('marks deployments that need provider approval in both graphs', () => {
		const gated = (deployments: Record<string, { approvalRequired: boolean }>) =>
			Object.entries(deployments)
				.filter(([, deployment]) => deployment.approvalRequired)
				.map(([deploymentId]) => deploymentId)
				.sort();
		const expected = [
			'anthropic-claude-mythos-5',
			'anthropic-claude-mythos-5-1',
			'anthropic-claude-mythos-5-1-us',
			'anthropic-claude-mythos-5-us',
			'anthropic-claude-opus-5-fast',
			'anthropic-claude-opus-5-fast-us',
			'azure-claude-mythos-5-1-anthropic-hosted',
			'azure-claude-mythos-5-anthropic-hosted',
			'openai-gpt-5.6-cyber'
		];
		expect(gated(catalog.graph.deployments)).toEqual(expected);
		expect(gated(catalog.graph.deployments)).toEqual(expected);
	});

	test('publishes OpenAI Fast naming and current GPT-5.6 prices', () => {
		const deployments = catalog.graph.deployments;
		// Token prices belong to the deployment, so every route has them.
		const prices = (deploymentId: keyof typeof deployments) =>
			deployments[deploymentId].routes['openai-responses'].pricing;
		expect(catalog.graph.models['gpt-5-search-api-2025-10-14']).toMatchObject({
			capabilities: {
				functionCalling: false,
				parallelFunctionCalling: false
			},
			contextWindowTokens: 200_000,
			maxOutputTokens: 128_000
		});
		for (const fastId of [
			'openai-gpt-5.5-2026-04-23-fast',
			'openai-gpt-5.6-luna-fast',
			'openai-gpt-5.6-sol-fast',
			'openai-gpt-5.6-terra-fast'
		] as const) {
			expect(deployments[fastId]).toMatchObject({
				upstream: { serviceTier: 'fast' }
			});
		}

		expect(prices('openai-gpt-5.6-luna')).toMatchObject({
			input_tokens: {
				per_mill_tokens: '0.2',
				per_mill_context_gt_272k: '0.4'
			},
			cached_input_tokens: {
				per_mill_tokens: '0.02',
				per_mill_context_gt_272k: '0.04'
			},
			cache_write_input_tokens: {
				per_mill_tokens: '0.25',
				per_mill_context_gt_272k: '0.5'
			},
			output_tokens: {
				per_mill_tokens: '1.2',
				per_mill_context_gt_272k: '1.8'
			}
		});
		expect(prices('openai-gpt-5.6-luna-flex')).toMatchObject({
			input_tokens: {
				per_mill_tokens: '0.1',
				per_mill_context_gt_272k: '0.2'
			},
			cached_input_tokens: {
				per_mill_tokens: '0.01',
				per_mill_context_gt_272k: '0.02'
			},
			cache_write_input_tokens: {
				per_mill_tokens: '0.125',
				per_mill_context_gt_272k: '0.25'
			},
			output_tokens: {
				per_mill_tokens: '0.6',
				per_mill_context_gt_272k: '0.9'
			}
		});
		expect(prices('openai-gpt-5.6-luna-fast')).toMatchObject({
			input_tokens: {
				per_mill_tokens: '0.4',
				per_mill_context_gt_272k: '0.8'
			},
			cached_input_tokens: {
				per_mill_tokens: '0.04',
				per_mill_context_gt_272k: '0.08'
			},
			cache_write_input_tokens: {
				per_mill_tokens: '0.5',
				per_mill_context_gt_272k: '1'
			},
			output_tokens: {
				per_mill_tokens: '2.4',
				per_mill_context_gt_272k: '3.6'
			}
		});
		expect(deployments['openai-gpt-5.6-luna-fast'].contextWindowTokens).toBe(1_050_000);
		expect(deployments['openai-gpt-5.6-luna-fast'].maxInputTokens).toBe(922_000);

		expect(prices('openai-gpt-5.6-sol-fast')).toMatchObject({
			input_tokens: {
				per_mill_tokens: '8',
				per_mill_context_gt_272k: '16'
			},
			cached_input_tokens: {
				per_mill_tokens: '0.8',
				per_mill_context_gt_272k: '1.6'
			},
			cache_write_input_tokens: {
				per_mill_tokens: '10',
				per_mill_context_gt_272k: '20'
			},
			output_tokens: {
				per_mill_tokens: '40',
				per_mill_context_gt_272k: '60'
			}
		});
		expect(prices('openai-gpt-5.6-sol')).toMatchObject({
			input_tokens: {
				per_mill_tokens: '4',
				per_mill_context_gt_272k: '8'
			},
			cached_input_tokens: {
				per_mill_tokens: '0.4',
				per_mill_context_gt_272k: '0.8'
			},
			cache_write_input_tokens: {
				per_mill_tokens: '5',
				per_mill_context_gt_272k: '10'
			},
			output_tokens: {
				per_mill_tokens: '20',
				per_mill_context_gt_272k: '30'
			}
		});
		for (const meter of [
			'input_tokens',
			'cached_input_tokens',
			'cache_write_input_tokens',
			'output_tokens'
		] as const) {
			for (const band of ['per_mill_tokens', 'per_mill_context_gt_272k'] as const) {
				const standard = coefficient(prices('openai-gpt-5.6-sol')[meter][band]);
				const flex = coefficient(prices('openai-gpt-5.6-sol-flex')[meter][band]);
				const fast = coefficient(prices('openai-gpt-5.6-sol-fast')[meter][band]);
				expect(flex * 2n).toBe(standard);
				expect(fast).toBe(standard * 2n);
			}
		}
		expect(deployments['openai-gpt-5.6-sol-fast'].contextWindowTokens).toBe(1_050_000);
		expect(deployments['openai-gpt-5.6-sol-fast'].maxInputTokens).toBe(922_000);

		expect(prices('openai-gpt-5.6-terra')).toMatchObject({
			input_tokens: {
				per_mill_tokens: '2',
				per_mill_context_gt_272k: '4'
			},
			cached_input_tokens: {
				per_mill_tokens: '0.2',
				per_mill_context_gt_272k: '0.4'
			},
			cache_write_input_tokens: {
				per_mill_tokens: '2.5',
				per_mill_context_gt_272k: '5'
			},
			output_tokens: {
				per_mill_tokens: '12',
				per_mill_context_gt_272k: '18'
			}
		});
		expect(prices('openai-gpt-5.6-terra-flex')).toMatchObject({
			input_tokens: {
				per_mill_tokens: '1',
				per_mill_context_gt_272k: '2'
			},
			cached_input_tokens: {
				per_mill_tokens: '0.1',
				per_mill_context_gt_272k: '0.2'
			},
			cache_write_input_tokens: {
				per_mill_tokens: '1.25',
				per_mill_context_gt_272k: '2.5'
			},
			output_tokens: {
				per_mill_tokens: '6',
				per_mill_context_gt_272k: '9'
			}
		});
		expect(prices('openai-gpt-5.6-terra-fast')).toMatchObject({
			input_tokens: {
				per_mill_tokens: '4',
				per_mill_context_gt_272k: '8'
			},
			cached_input_tokens: {
				per_mill_tokens: '0.4',
				per_mill_context_gt_272k: '0.8'
			},
			cache_write_input_tokens: {
				per_mill_tokens: '5',
				per_mill_context_gt_272k: '10'
			},
			output_tokens: {
				per_mill_tokens: '24',
				per_mill_context_gt_272k: '36'
			}
		});
		expect(deployments['openai-gpt-5.6-terra-fast'].contextWindowTokens).toBe(1_050_000);
		expect(deployments['openai-gpt-5.6-terra-fast'].maxInputTokens).toBe(922_000);
	});

	test('publishes every GPT-5.6 and GPT-6 Pro service tier as a Responses-only deployment', () => {
		const deployments = catalog.graph.deployments;
		for (const modelId of [
			'gpt-5.6-luna',
			'gpt-5.6-sol',
			'gpt-5.6-terra',
			'gpt-6-astra',
			'gpt-6-luna',
			'gpt-6-sol',
			'gpt-6.1-sol',
			'gpt-6.1-terra'
		] as const) {
			for (const [suffix, serviceTier] of [
				['', 'standard'],
				['-flex', 'flex'],
				['-fast', 'fast']
			] as const) {
				const deploymentId = `openai-${modelId}-pro${suffix}`;
				const peer = deployments[`openai-${modelId}${suffix}`];
				const pro = deployments[deploymentId];
				expect(pro).toMatchObject({
					modelId,
					upstream: { model: modelId, reasoningMode: 'pro', serviceTier }
				});
				expect(Object.keys(pro.routes)).toEqual(['openai-responses']);
				expect(pro.routes['openai-responses'].pricing).toEqual(
					peer.routes['openai-responses'].pricing
				);
				expect(pro.contextWindowTokens).toBe(peer.contextWindowTokens);
				expect(catalog.graph.deployments[deploymentId]).toBeDefined();
			}
		}
	});

	test('publishes exact GPT-6 tier prices and Ultrafast only for Astra and GPT-6.1 Sol', () => {
		const deployments = catalog.graph.deployments;
		expect(
			Object.fromEntries(
				Object.entries(deployments)
					.filter(([, deployment]) => deployment.upstream.serviceTier === 'ultrafast')
					.map(([deploymentId, deployment]) => [deploymentId, Object.keys(deployment.routes)])
			)
		).toEqual({
			'openai-gpt-6-astra-ultrafast': ['openai-responses'],
			'openai-gpt-6.1-sol-ultrafast': ['openai-responses']
		});

		// OpenAI Standard input, cached input, and output prices per million tokens up to 272K.
		const standardRates = {
			'gpt-6-astra': ['10', '1', '50'],
			'gpt-6-luna': ['0.1', '0.01', '0.5'],
			'gpt-6-sol': ['2', '0.2', '10'],
			'gpt-6.1-sol': ['2', '0.1', '10'],
			'gpt-6.1-terra': ['1', '0.05', '5']
		} as const;
		const tierScale = {
			standard: [1n, 1n],
			flex: [1n, 2n],
			fast: [2n, 1n],
			ultrafast: [6n, 1n]
		} as const;
		const checked: string[] = [];
		for (const [deploymentId, deployment] of Object.entries(deployments)) {
			if (!deploymentId.startsWith('openai-') || !(deployment.modelId in standardRates)) continue;
			const [input, cached, output] =
				standardRates[deployment.modelId as keyof typeof standardRates].map(coefficient);
			const [numerator, denominator] =
				tierScale[deployment.upstream.serviceTier as keyof typeof tierScale];
			// Cache writes cost 1.25x input. Prompts over 272K double input rates and raise output by half.
			for (const [meter, short, long] of [
				['input_tokens', input, input * 2n],
				['cached_input_tokens', cached, cached * 2n],
				['cache_write_input_tokens', (input * 5n) / 4n, (input * 5n) / 2n],
				['output_tokens', output, (output * 3n) / 2n]
			] as const) {
				for (const route of Object.values(deployment.routes)) {
					const rates = route.pricing[meter];
					expect(Object.keys(rates).sort()).toEqual([
						'per_mill_context_gt_272k',
						'per_mill_tokens'
					]);
					expect(coefficient(rates.per_mill_tokens)).toBe((short * numerator) / denominator);
					expect(coefficient(rates.per_mill_context_gt_272k)).toBe(
						(long * numerator) / denominator
					);
				}
			}
			const chat = (deployment.routes as Record<string, { reasoningEfforts: string[] }>)[
				'openai-chat-completions'
			];
			if (chat) expect(chat.reasoningEfforts).toEqual(['low', 'medium', 'high', 'xhigh']);
			checked.push(deploymentId);
		}
		expect(checked).toHaveLength(32);
	});

	test('puts each place in every place that holds all the places directly inside it', () => {
		const { locations } = catalog;
		const { within, inside } = placeIndex(locations);
		for (const id of Object.keys(locations)) {
			const members = Object.keys(locations).filter((place) =>
				locations[place]!.parentIds.includes(id)
			);
			if (!members.length) continue;
			// A policy that names a place admits a deployment in a place that it holds.
			const holders = within
				.get(members[0]!)!
				.filter(
					(place) =>
						!within.get(id)!.includes(place) &&
						!inside.get(id)!.includes(place) &&
						members.every((member) => within.get(member)!.includes(place))
				);
			expect(holders, id).toEqual([]);
		}
	});

	test('keeps one deterministic catalog without dated states', () => {
		expect(catalog.schema).toBe('stogas.catalog.v10');
		expect(catalog.schedule).toEqual([]);
	});

	test('orders parts so that they retire as a whole', () => {
		const dates = catalogRoot.parts.map(({ through }) => through);
		const undated = dates.filter((date) => date === null).length;
		// Parts without a retirement date come first, and the others follow by their latest date.
		expect(dates.slice(0, undated).every((date) => date === null)).toBe(true);
		expect(dates.slice(undated)).toEqual(dates.slice(undated).toSorted());
		for (const [kind, summaries] of Object.entries(catalogRoot.summaries))
			for (const summary of Object.values(summaries)) {
				if (!('part' in summary)) continue;
				// A part's date is the latest of its records', and it has one only when they all do.
				const { through } = catalogRoot.parts[summary.part]!;
				if (summary.retirementDate === null) expect(through).toBeNull();
				else expect(through !== null && summary.retirementDate <= through, kind).toBe(true);
			}
	});
});
