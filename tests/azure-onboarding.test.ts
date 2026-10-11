import { describe, expect, test } from 'bun:test';
import publicCatalog from '../generated/catalog.public.json';
import runtimeCatalog from '../generated/catalog.runtime.json';

type AzureTarget = {
	id: string;
	modelId: string;
	routeIds: string[];
	upstream: Record<string, string>;
};

const allReasoningEfforts = ['low', 'medium', 'high', 'xhigh', 'max'];
const chatReasoningEfforts = ['low', 'medium', 'high', 'xhigh'];

function azureDeployments() {
	return Object.entries(runtimeCatalog.graph.deployments).filter(([, deployment]) =>
		deployment.routeIds.some((routeId) => routeId.startsWith('azure-'))
	);
}

function gptTargets(tier: 'luna' | 'sol' | 'terra'): AzureTarget[] {
	const modelId = `gpt-5.6-${tier}`;
	const base = `azure-${modelId}`;
	const targets: AzureTarget[] = [];
	for (const location of ['global', 'eu', 'instant', 'us'] as const) {
		const deploymentType =
			location === 'global'
				? 'global_standard'
				: location === 'instant'
					? 'instant'
					: `data_zone_standard_${location}`;
		const suffix = location === 'global' ? '' : `-${location}`;
		const upstream = {
			deploymentType,
			hosting: 'azure',
			model: modelId,
			modelFormat: 'OpenAI',
			modelVersion: '2026-07-09',
			serviceTier: 'default'
		};
		targets.push({
			id: `${base}${suffix}`,
			modelId,
			routeIds: ['azure-chat-completions', 'azure-responses'],
			upstream
		});
		targets.push({
			id: `${base}-pro${suffix}`,
			modelId,
			routeIds: ['azure-responses'],
			upstream: { ...upstream, reasoningMode: 'pro' }
		});
	}
	if (tier !== 'luna') {
		targets.push(
			{
				id: `${base}-fast`,
				modelId,
				routeIds: ['azure-chat-completions', 'azure-responses'],
				upstream: {
					deploymentType: 'global_standard',
					hosting: 'azure',
					model: modelId,
					modelFormat: 'OpenAI',
					modelVersion: '2026-07-09',
					serviceTier: 'priority'
				}
			},
			{
				id: `${base}-pro-fast`,
				modelId,
				routeIds: ['azure-responses'],
				upstream: {
					deploymentType: 'global_standard',
					hosting: 'azure',
					model: modelId,
					modelFormat: 'OpenAI',
					modelVersion: '2026-07-09',
					reasoningMode: 'pro',
					serviceTier: 'priority'
				}
			}
		);
	}
	return targets;
}

const otherTargets: AzureTarget[] = [
	['azure-claude-fable-5-anthropic-hosted', 'claude-fable-5', '1', 'anthropic', 'global_standard'],
	[
		'azure-claude-opus-4-7-anthropic-hosted',
		'claude-opus-4-7',
		'1',
		'anthropic',
		'global_standard'
	],
	['azure-claude-opus-4-8', 'claude-opus-4-8', '2', 'azure', 'global_standard'],
	[
		'azure-claude-opus-4-8-anthropic-hosted',
		'claude-opus-4-8',
		'1',
		'anthropic',
		'global_standard'
	],
	['azure-claude-opus-4-8-us', 'claude-opus-4-8', '2', 'azure', 'data_zone_standard_us'],
	['azure-claude-opus-5', 'claude-opus-5', '2', 'azure', 'global_standard'],
	['azure-claude-opus-5-anthropic-hosted', 'claude-opus-5', '1', 'anthropic', 'global_standard'],
	['azure-claude-opus-5-us', 'claude-opus-5', '2', 'azure', 'data_zone_standard_us'],
	[
		'azure-claude-sonnet-4-6-anthropic-hosted',
		'claude-sonnet-4-6',
		'1',
		'anthropic',
		'global_standard'
	],
	['azure-claude-sonnet-5', 'claude-sonnet-5', '2', 'azure', 'global_standard'],
	[
		'azure-claude-sonnet-5-anthropic-hosted',
		'claude-sonnet-5',
		'1',
		'anthropic',
		'global_standard'
	],
	['azure-claude-sonnet-5-us', 'claude-sonnet-5', '2', 'azure', 'data_zone_standard_us']
].map(([id, modelId, modelVersion, hosting, deploymentType]) => ({
	id,
	modelId,
	routeIds: ['azure-anthropic-messages'],
	upstream: {
		deploymentType,
		hosting,
		model: modelId,
		modelFormat: 'Anthropic',
		modelVersion
	}
}));

otherTargets.push(
	{
		id: 'azure-deepseek-v3.2',
		modelId: 'deepseek-v3.2',
		routeIds: ['azure-chat-completions'],
		upstream: {
			deploymentType: 'global_standard',
			hosting: 'azure',
			model: 'DeepSeek-V3.2',
			modelFormat: 'DeepSeek',
			modelVersion: '1'
		}
	},
	...(['global', 'eu', 'us'] as const).map((location) => ({
		id: `azure-deepseek-v4-flash-0423${location === 'global' ? '' : `-${location}`}`,
		modelId: 'deepseek-v4-flash-0423',
		routeIds: ['azure-chat-completions'],
		upstream: {
			deploymentType: location === 'global' ? 'global_standard' : `data_zone_standard_${location}`,
			hosting: 'azure',
			model: 'DeepSeek-V4-Flash',
			modelFormat: 'DeepSeek',
			modelVersion: '2026-04-23'
		}
	})),
	...(['global', 'us'] as const).map((location) => ({
		id: `azure-deepseek-v4-pro${location === 'global' ? '' : `-${location}`}`,
		modelId: 'deepseek-v4-pro',
		routeIds: ['azure-chat-completions'],
		upstream: {
			deploymentType: location === 'global' ? 'global_standard' : 'data_zone_standard_us',
			hosting: 'azure',
			model: 'DeepSeek-V4-Pro',
			modelFormat: 'DeepSeek',
			modelVersion: '2026-04-23'
		}
	})),
	{
		id: 'azure-deepseek-v4-pro-fireworks-hosted-us',
		modelId: 'deepseek-v4-pro',
		routeIds: ['azure-chat-completions'],
		upstream: {
			deploymentType: 'data_zone_standard_us',
			hosting: 'fireworks',
			model: 'FW-DeepSeek-V4-Pro',
			modelFormat: 'Fireworks',
			modelVersion: '1'
		}
	},
	{
		id: 'azure-glm-5.2',
		modelId: 'glm-5.2',
		routeIds: ['azure-chat-completions'],
		upstream: {
			deploymentType: 'data_zone_standard_us',
			hosting: 'fireworks',
			model: 'FW-GLM-5.2',
			modelFormat: 'Fireworks',
			modelVersion: '1'
		}
	},
	...(['global', 'us'] as const).map((location) => ({
		id: `azure-gpt-oss-120b${location === 'global' ? '' : '-us'}`,
		modelId: 'gpt-oss-120b',
		routeIds: ['azure-chat-completions'],
		upstream: {
			deploymentType: location === 'global' ? 'global_standard' : 'data_zone_standard_us',
			hosting: 'azure',
			model: 'gpt-oss-120b',
			modelFormat: 'OpenAI-OSS',
			modelVersion: '1'
		}
	})),
	{
		id: 'azure-minimax-m3',
		modelId: 'minimax-m3',
		routeIds: ['azure-chat-completions'],
		upstream: {
			deploymentType: 'data_zone_standard_us',
			hosting: 'fireworks',
			model: 'FW-MiniMax-M3',
			modelFormat: 'Fireworks',
			modelVersion: '1'
		}
	}
);

// Independent exact arithmetic for the reviewed price relationships.
function scaled(value: string, numerator: bigint, denominator = 1n) {
	const [whole, fraction = ''] = value.split('.');
	const coefficient = BigInt(whole! + fraction.padEnd(36, '0'));
	const scaledValue = coefficient * numerator;
	expect(scaledValue % denominator).toBe(0n);
	const digits = (scaledValue / denominator).toString().padStart(37, '0');
	return `${digits.slice(0, -36)}.${digits.slice(-36)}`.replace(/0+$/, '').replace(/\.$/, '');
}

function gptPricing(
	input: string,
	output: string,
	options: { dataZone: boolean; priority: boolean }
) {
	const regionNumerator = options.dataZone ? 11n : 10n;
	const shortInput = scaled(input, regionNumerator, 10n);
	const shortCached = scaled(shortInput, 1n, 10n);
	const shortWrite = scaled(shortInput, 5n, 4n);
	const shortOutput = scaled(output, regionNumerator, 10n);
	return {
		cache_write_input_tokens: {
			per_mill_context_gt_272k: scaled(shortWrite, options.priority ? 4n : 2n),
			per_mill_context_lte_272k: scaled(shortWrite, options.priority ? 2n : 1n)
		},
		cached_input_tokens: {
			per_mill_context_gt_272k: scaled(shortCached, options.priority ? 4n : 2n),
			per_mill_context_lte_272k: scaled(shortCached, options.priority ? 2n : 1n)
		},
		input_tokens: {
			per_mill_context_gt_272k: scaled(shortInput, options.priority ? 4n : 2n),
			per_mill_context_lte_272k: scaled(shortInput, options.priority ? 2n : 1n)
		},
		output_tokens: {
			per_mill_context_gt_272k: scaled(shortOutput, options.priority ? 6n : 3n, 2n),
			per_mill_context_lte_272k: scaled(shortOutput, options.priority ? 2n : 1n)
		}
	};
}

function claudePricing(input: string, output: string, dataZone: boolean) {
	const adjustedInput = dataZone ? scaled(input, 11n, 10n) : input;
	const adjustedOutput = dataZone ? scaled(output, 11n, 10n) : output;
	return {
		cache_write_1h_input_tokens: { per_mill_tokens: scaled(adjustedInput, 2n) },
		cache_write_5m_input_tokens: { per_mill_tokens: scaled(adjustedInput, 5n, 4n) },
		cached_input_tokens: { per_mill_tokens: scaled(adjustedInput, 1n, 10n) },
		input_tokens: { per_mill_tokens: adjustedInput.toString() },
		output_tokens: { per_mill_tokens: adjustedOutput.toString() }
	};
}

describe('Azure provider onboarding contract', () => {
	test('publishes the exact verified Azure target matrix without duplicates', () => {
		const expected = [
			...gptTargets('luna'),
			...gptTargets('sol'),
			...gptTargets('terra'),
			...otherTargets
		].sort((left, right) => left.id.localeCompare(right.id));
		const actual = azureDeployments()
			.map(([id, deployment]) => ({
				id,
				modelId: deployment.modelId,
				routeIds: [...deployment.routeIds].sort(),
				upstream: deployment.upstream
			}))
			.sort((left, right) => left.id.localeCompare(right.id));
		expect(actual).toEqual(expected);
		expect(new Set(actual.map(({ id }) => id)).size).toBe(actual.length);
	});

	test('keeps Azure BYOK-only and uses only the three verified wire routes', () => {
		expect(runtimeCatalog.graph.providers.azure).toEqual({
			aliases: ['azure-ai-foundry', 'azure-openai'],
			credentialModes: ['byok'],
			name: 'Azure'
		});
		expect(
			Object.entries(runtimeCatalog.graph.routes)
				.filter(([, route]) => route.providerId === 'azure')
				.map(([id]) => id)
				.sort()
		).toEqual(['azure-anthropic-messages', 'azure-chat-completions', 'azure-responses']);
		expect(publicCatalog.graph.providers.azure.credentialModes).toEqual(['byok']);
	});

	test('pins GPT-5.6 standard, data-zone, Instant, Pro, and Priority prices', () => {
		const baseRates = {
			'gpt-5.6-luna': ['0.2', '1.2'],
			'gpt-5.6-sol': ['4', '20'],
			'gpt-5.6-terra': ['2', '12']
		} as const;
		for (const [, deployment] of azureDeployments()) {
			if (!(deployment.modelId in baseRates)) continue;
			const [input, output] = baseRates[deployment.modelId as keyof typeof baseRates];
			expect(deployment.pricing).toEqual(
				gptPricing(input, output, {
					dataZone: deployment.upstream.deploymentType.startsWith('data_zone_standard_'),
					priority: deployment.upstream.serviceTier === 'priority'
				})
			);
			expect(deployment.contextWindowTokens).toBe(1_050_000);
			expect(deployment.maxOutputTokens).toBe(128_000);
			expect(deployment.reasoningEfforts).toEqual(allReasoningEfforts);
			expect(deployment.reasoningMaxTokens).toBeNull();
			if (deployment.upstream.reasoningMode === 'pro') {
				expect(deployment.routeIds).toEqual(['azure-responses']);
			} else {
				expect(deployment.routeOverrides).toEqual({
					'azure-chat-completions': { reasoningEfforts: chatReasoningEfforts }
				});
			}
		}
		expect(runtimeCatalog.graph.deployments['azure-gpt-5.6-luna-fast']).toBeUndefined();
		expect(runtimeCatalog.graph.deployments['azure-gpt-5.6-luna-pro-fast']).toBeUndefined();
	});

	test('does not stack Pro and Priority prices', () => {
		for (const tier of ['sol', 'terra'] as const) {
			const base = runtimeCatalog.graph.deployments[`azure-gpt-5.6-${tier}`];
			const pro = runtimeCatalog.graph.deployments[`azure-gpt-5.6-${tier}-pro`];
			const fast = runtimeCatalog.graph.deployments[`azure-gpt-5.6-${tier}-fast`];
			const proFast = runtimeCatalog.graph.deployments[`azure-gpt-5.6-${tier}-pro-fast`];
			expect(pro.pricing).toEqual(base.pricing);
			expect(proFast.pricing).toEqual(fast.pricing);
		}
	});

	test('pins Claude hosting, reasoning, model-specific retention, and prices separately', () => {
		const prices = {
			'claude-fable-5': ['10', '50'],
			'claude-opus-4-7': ['5', '25'],
			'claude-opus-4-8': ['5', '25'],
			'claude-opus-5': ['5', '25'],
			'claude-sonnet-4-6': ['3', '15'],
			'claude-sonnet-5': ['2', '10']
		} as const;
		for (const [, deployment] of azureDeployments()) {
			if (!(deployment.modelId in prices)) continue;
			const [input, output] = prices[deployment.modelId as keyof typeof prices];
			expect(deployment.pricing).toEqual(
				claudePricing(input, output, deployment.upstream.deploymentType === 'data_zone_standard_us')
			);
			const handling = deployment.dataHandlingByRoute['azure-anthropic-messages'];
			expect(handling.retentionDays).toBe(deployment.modelId === 'claude-fable-5' ? 30 : 0);
			if (deployment.modelId === 'claude-fable-5') {
				expect(handling.storageLocation).toBe('unknown');
			} else if (deployment.upstream.hosting === 'anthropic') {
				expect(handling.storageLocation).toBe('none');
			}
			expect(deployment.upstream).not.toHaveProperty('speed');
			expect(deployment.upstream).not.toHaveProperty('serviceTier');
		}
		expect(
			runtimeCatalog.graph.deployments['azure-claude-sonnet-4-6-anthropic-hosted']
				.reasoningMaxTokens
		).toEqual({
			minimum: 1024,
			maximum: 127_999
		});
	});

	test('pins all non-GPT and non-Claude token prices', () => {
		const expected = {
			'azure-deepseek-v3.2': ['0.58', '0.58', '1.68'],
			'azure-deepseek-v4-flash-0423': ['0.19', '0.028', '0.51'],
			'azure-deepseek-v4-flash-0423-eu': ['0.21', '0.031', '0.56'],
			'azure-deepseek-v4-flash-0423-us': ['0.21', '0.031', '0.56'],
			'azure-deepseek-v4-pro': ['1.74', '0.145', '3.48'],
			'azure-deepseek-v4-pro-fireworks-hosted-us': ['1.925', '0.165', '3.828'],
			'azure-deepseek-v4-pro-us': ['1.91', '0.16', '3.83'],
			'azure-glm-5.2': ['1.54', '0.15', '4.84'],
			'azure-minimax-m3': ['0.33', '0.066', '1.32']
		} as const;
		for (const [id, [input, cached, output]] of Object.entries(expected)) {
			expect(runtimeCatalog.graph.deployments[id].pricing).toEqual({
				cached_input_tokens: { per_mill_tokens: cached },
				input_tokens: { per_mill_tokens: input },
				output_tokens: { per_mill_tokens: output }
			});
		}
		expect(runtimeCatalog.graph.deployments['azure-gpt-oss-120b'].pricing).toEqual({
			input_tokens: { per_mill_tokens: '0.15' },
			output_tokens: { per_mill_tokens: '0.6' }
		});
		expect(runtimeCatalog.graph.deployments['azure-gpt-oss-120b-us'].pricing).toEqual({
			input_tokens: { per_mill_tokens: '0.165' },
			output_tokens: { per_mill_tokens: '0.66' }
		});
	});

	test('keeps public regions conservative and does not invent capacity-metered deployments', () => {
		for (const [, deployment] of azureDeployments()) {
			for (const handling of Object.values(deployment.dataHandlingByRoute)) {
				if (
					deployment.upstream.hosting === 'azure' &&
					deployment.upstream.deploymentType === 'data_zone_standard_us'
				) {
					expect(handling).toMatchObject({ processingLocation: 'US', storageLocation: 'US' });
				}
				if (
					deployment.upstream.hosting === 'azure' &&
					deployment.upstream.deploymentType === 'data_zone_standard_eu'
				) {
					expect(handling).toMatchObject({
						processingLocation: 'europe',
						storageLocation: 'europe'
					});
				}
				if (deployment.upstream.hosting === 'fireworks') {
					expect(handling).toMatchObject({
						processingLocation: 'unknown',
						storageLocation: 'unknown'
					});
				}
			}
		}
		const azureModelIds = new Set(azureDeployments().map(([, deployment]) => deployment.modelId));
		for (const modelId of [
			'gemma-4-31b',
			'gemma-4-26b-a4b',
			'nemotron-3-super',
			'nemotron-3-ultra'
		]) {
			expect(publicCatalog.graph.models[modelId]).toBeDefined();
			expect(azureModelIds.has(modelId)).toBe(false);
		}
	});
});
