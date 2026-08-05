import { describe, expect, test } from 'bun:test';
import publicCatalog from '../generated/catalog.public.json';
import runtimeCatalog from '../generated/catalog.runtime.json';

const graphNodeTypes = ['authors', 'models', 'providers', 'routes', 'deployments'] as const;
const canonicalEffortOrder = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const canonicalEfforts = new Set(canonicalEffortOrder);
const reasoningAvailabilities = new Set(['unsupported', 'optional', 'required']);

describe('compiled catalog v1', () => {
	test('contains exactly the five useful graph primitives', () => {
		expect(Object.keys(publicCatalog.graph).sort()).toEqual([...graphNodeTypes].sort());
		expect(Object.keys(runtimeCatalog.graph).sort()).toEqual([...graphNodeTypes].sort());
		expect(JSON.stringify(publicCatalog)).not.toMatch(
			/providerOfferings|executionVariants|modelReleases|providerEndpoints|stogasEndpoints/
		);
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

	test('uses catalog model slugs directly for Azure', () => {
		for (const deployment of Object.values(runtimeCatalog.graph.deployments)) {
			if (!deployment.routeIds.some((routeId) => routeId.startsWith('azure-'))) continue;
			expect(deployment.upstream.model).toBe(deployment.modelId);
		}
	});

	test('keeps aliases inline, selectors explicit, and globally unique', () => {
		const selectors = new Set<string>();
		for (const [modelId, model] of Object.entries(runtimeCatalog.graph.models)) {
			for (const selector of [modelId, ...model.aliases]) {
				expect(selector).not.toContain('/');
				expect(selectors.has(selector)).toBe(false);
				selectors.add(selector);
			}
		}
		for (const deployment of Object.values(runtimeCatalog.graph.deployments)) {
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
		).toMatchObject({
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
			expect(deployment).not.toHaveProperty('dataHandling');
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
			reasoningMaxTokens: { maximum: 131071, minimum: 1 }
		});
		expect(runtimeCatalog.graph.deployments['chutes-nemotron-3-nano-omni-30b']).toMatchObject({
			reasoningAvailability: 'optional',
			reasoningEfforts: [],
			reasoningMaxTokens: null
		});
	});

	test('materializes public privacy and moderation facts', () => {
		for (const deployment of Object.values(publicCatalog.graph.deployments)) {
			expect(typeof deployment.moderated).toBe('boolean');
			expect(deployment.dataHandling).toHaveProperty('processingRegions');
			expect(deployment.dataHandling).toHaveProperty('storageRegions');
			expect(typeof deployment.dataHandling.trainingUse).toBe('boolean');
			expect(typeof deployment.dataHandling.zeroDataRetention).toBe('boolean');
			expect(deployment.dataHandling).not.toHaveProperty('gdpr');
			expect(deployment).not.toHaveProperty('provenance');
		}
		expect(publicCatalog).not.toHaveProperty('evidence');
	});

	test('keeps Anthropic selection literal and its guarantee normalized', () => {
		const deployment = runtimeCatalog.graph.deployments['anthropic-claude-opus-4-8-fast-us'];
		expect(deployment.routeIds).toEqual(['anthropic-messages']);
		expect(deployment.upstream).toEqual({
			inferenceGeo: 'us',
			model: 'claude-opus-4-8',
			serviceTier: 'standard_only',
			speed: 'fast'
		});
		expect(
			publicCatalog.graph.deployments['anthropic-claude-opus-4-8-fast-us'].dataHandling
				.processingRegions
		).toEqual(['us']);
	});

	test('publishes OpenAI Fast naming and current GPT-5.6 prices', () => {
		const deployments = runtimeCatalog.graph.deployments;
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
			input_tokens: { per_mill_tokens: '400000000000000000' },
			cached_input_tokens: { per_mill_tokens: '40000000000000000' },
			cache_write_input_tokens: { per_mill_tokens: '500000000000000000' },
			output_tokens: { per_mill_tokens: '2400000000000000000' }
		});

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
			input_tokens: { per_mill_tokens: '4000000000000000000' },
			cached_input_tokens: { per_mill_tokens: '400000000000000000' },
			cache_write_input_tokens: { per_mill_tokens: '5000000000000000000' },
			output_tokens: { per_mill_tokens: '24000000000000000000' }
		});
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
		expect(runtimeCatalog.schema).toBe('stogas.catalog.runtime.v1');
		expect(publicCatalog.schema).toBe('stogas.catalog.public.v1');
	});
});
