import { describe, expect, test } from 'bun:test';
import { catalog } from './generated-catalog';

type AzureTarget = {
	id: string;
	modelId: string;
	routeIds: string[];
	hosting: string;
	upstream: Record<string, string>;
};

const allReasoningEfforts = ['low', 'medium', 'high', 'xhigh', 'max'];
const chatReasoningEfforts = ['low', 'medium', 'high', 'xhigh'];

function azureDeployments() {
	return Object.entries(catalog.graph.deployments).filter(([, deployment]) =>
		Object.keys(deployment.routes).some((routeId) => routeId.startsWith('azure-'))
	);
}

type AzureLocation = 'global' | 'apac' | 'eu' | 'instant' | 'us';

// Each node is a deployment for both routes, or both batch routes, plus, for models with Pro, a
// Responses-only Pro deployment.
function gptTargets(
	modelId: string,
	modelVersion: string,
	nodes: readonly (readonly ['standard' | 'flex' | 'fast' | 'batch', AzureLocation])[],
	{
		model = modelId,
		pro = true,
		routeIds = ['azure-chat-completions', 'azure-responses']
	}: { model?: string; pro?: boolean; routeIds?: string[] } = {}
): AzureTarget[] {
	return nodes.flatMap(([tier, location]) => {
		const tierSuffix = tier === 'standard' ? '' : `-${tier}`;
		const suffix = `${tierSuffix}${location === 'global' ? '' : `-${location}`}`;
		const kind = tier === 'batch' ? 'batch' : 'standard';
		const upstream = {
			deploymentType:
				location === 'global'
					? `global_${kind}`
					: location === 'instant'
						? 'instant'
						: `data_zone_${kind}_${location}`,
			model,
			modelFormat: 'OpenAI',
			modelVersion,
			serviceTier: tier === 'batch' ? 'standard' : tier
		};
		const base = {
			id: `azure-${modelId}${suffix}`,
			modelId,
			routeIds:
				tier === 'batch'
					? routeIds.map((routeId) => routeId.replace('azure-', 'azure-batch-'))
					: routeIds,
			hosting: 'azure',
			upstream
		};
		return pro
			? [
					base,
					{
						id: `azure-${modelId}-pro${suffix}`,
						modelId,
						routeIds: ['azure-responses'],
						hosting: 'azure',
						upstream: { ...upstream, reasoningMode: 'pro' }
					}
				]
			: [base];
	});
}

const standardNodes = (['global', 'eu', 'instant', 'us'] as const).map(
	(location) => ['standard', location] as const
);
const gpt54Nodes = [
	...standardNodes,
	['standard', 'apac'],
	['fast', 'global'],
	['fast', 'us'],
	['batch', 'global'],
	['batch', 'us']
] as const;

const otherTargets: AzureTarget[] = [
	['azure-claude-fable-5-anthropic-hosted', 'claude-fable-5', '1', 'anthropic', 'global_standard'],
	[
		'azure-claude-fable-5-1-anthropic-hosted',
		'claude-fable-5-1',
		'1',
		'anthropic',
		'global_standard'
	],
	[
		'azure-claude-fable-5-2-anthropic-hosted',
		'claude-fable-5-2',
		'1',
		'anthropic',
		'global_standard'
	],
	['azure-claude-haiku-5-5', 'claude-haiku-5-5', '2', 'azure', 'global_standard'],
	[
		'azure-claude-haiku-5-5-anthropic-hosted',
		'claude-haiku-5-5',
		'1',
		'anthropic',
		'global_standard'
	],
	['azure-claude-haiku-5-5-us', 'claude-haiku-5-5', '2', 'azure', 'data_zone_standard_us'],
	[
		'azure-claude-mythos-5-anthropic-hosted',
		'claude-mythos-5',
		'1',
		'anthropic',
		'global_standard'
	],
	[
		'azure-claude-mythos-5-1-anthropic-hosted',
		'claude-mythos-5-1',
		'1',
		'anthropic',
		'global_standard'
	],
	[
		'azure-claude-mythos-5-2-anthropic-hosted',
		'claude-mythos-5-2',
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
	['azure-claude-opus-5-5', 'claude-opus-5-5', '2', 'azure', 'global_standard'],
	[
		'azure-claude-opus-5-5-anthropic-hosted',
		'claude-opus-5-5',
		'1',
		'anthropic',
		'global_standard'
	],
	['azure-claude-opus-5-5-us', 'claude-opus-5-5', '2', 'azure', 'data_zone_standard_us'],
	['azure-claude-sonnet-5-5', 'claude-sonnet-5-5', '2', 'azure', 'global_standard'],
	[
		'azure-claude-sonnet-5-5-anthropic-hosted',
		'claude-sonnet-5-5',
		'1',
		'anthropic',
		'global_standard'
	],
	['azure-claude-sonnet-5-5-us', 'claude-sonnet-5-5', '2', 'azure', 'data_zone_standard_us']
].map(([id, modelId, modelVersion, hosting, deploymentType]) => ({
	id,
	modelId,
	routeIds: ['azure-anthropic-messages'],
	hosting,
	upstream: {
		deploymentType,
		model: modelId,
		modelFormat: 'Anthropic',
		modelVersion
	}
}));

otherTargets.push(
	// Azure sells Fast as its own model: Anthropic runs it for Claude Fable 5.2 and Mythos 5.2.
	...(['claude-fable-5-2', 'claude-mythos-5-2'] as const).map((modelId) => ({
		id: `azure-${modelId}-anthropic-hosted-fast`,
		modelId,
		routeIds: ['azure-anthropic-messages'],
		hosting: 'anthropic',
		upstream: {
			deploymentType: 'global_standard',
			model: `${modelId}-fast`,
			modelFormat: 'Anthropic',
			modelVersion: '1',
			serviceTier: 'fast'
		}
	})),
	// Azure sells Claude Opus 5.5 Fast as its own model.
	...(['global', 'us'] as const).map((location) => ({
		id: `azure-claude-opus-5-5-fast${location === 'global' ? '' : '-us'}`,
		modelId: 'claude-opus-5-5',
		routeIds: ['azure-anthropic-messages'],
		hosting: 'azure',
		upstream: {
			deploymentType: location === 'global' ? 'global_standard' : 'data_zone_standard_us',
			model: 'claude-opus-5-5-fast',
			modelFormat: 'Anthropic',
			modelVersion: '2',
			serviceTier: 'fast'
		}
	})),
	...(['global', 'eu', 'us'] as const).map((location) => ({
		id: `azure-deepseek-v4-flash-0423${location === 'global' ? '' : `-${location}`}`,
		modelId: 'deepseek-v4-flash-0423',
		routeIds: ['azure-chat-completions'],
		hosting: 'azure',
		upstream: {
			deploymentType: location === 'global' ? 'global_standard' : `data_zone_standard_${location}`,
			model: 'DeepSeek-V4-Flash',
			modelFormat: 'DeepSeek',
			modelVersion: '2026-04-23'
		}
	})),
	...(['global', 'us'] as const).map((location) => ({
		id: `azure-deepseek-v4-pro${location === 'global' ? '' : `-${location}`}`,
		modelId: 'deepseek-v4-pro',
		routeIds: ['azure-chat-completions'],
		hosting: 'azure',
		upstream: {
			deploymentType: location === 'global' ? 'global_standard' : 'data_zone_standard_us',
			model: 'DeepSeek-V4-Pro',
			modelFormat: 'DeepSeek',
			modelVersion: '2026-04-23'
		}
	})),
	...(['global', 'us'] as const).map((location) => ({
		id: `azure-gpt-oss-120b${location === 'global' ? '' : '-us'}`,
		modelId: 'gpt-oss-120b',
		routeIds: ['azure-chat-completions'],
		hosting: 'azure',
		upstream: {
			deploymentType: location === 'global' ? 'global_standard' : 'data_zone_standard_us',
			model: 'gpt-oss-120b',
			modelFormat: 'OpenAI-OSS',
			modelVersion: '1'
		}
	})),
	{
		id: 'azure-minimax-m3-fireworks-hosted-us',
		modelId: 'minimax-m3',
		routeIds: ['azure-chat-completions'],
		hosting: 'fireworks',
		upstream: {
			deploymentType: 'data_zone_standard_us',
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

// Long prompts double the input prices and raise the output price by half.
function gptPricing(rates: readonly string[], numerator: bigint, denominator: bigint) {
	const [input, cached, output] = rates.map((rate) => scaled(rate, numerator, denominator));
	const write = scaled(input!, 5n, 4n);
	return {
		cache_write_input_tokens: {
			per_mill_context_gt_272k: scaled(write, 2n),
			per_mill_tokens: write
		},
		cached_input_tokens: {
			per_mill_context_gt_272k: scaled(cached!, 2n),
			per_mill_tokens: cached
		},
		input_tokens: {
			per_mill_context_gt_272k: scaled(input!, 2n),
			per_mill_tokens: input
		},
		output_tokens: {
			per_mill_context_gt_272k: scaled(output!, 3n, 2n),
			per_mill_tokens: output
		}
	};
}

function claudePricing(
	input: string,
	output: string,
	options: { dataZone: boolean; cacheReadDivisor: bigint; longPromptMultiplier?: bigint }
) {
	const adjustedInput = options.dataZone ? scaled(input, 11n, 10n) : input;
	const adjustedOutput = options.dataZone ? scaled(output, 11n, 10n) : output;
	const rate = (value: string) =>
		options.longPromptMultiplier === undefined
			? { per_mill_tokens: value }
			: {
					per_mill_context_gt_100k: scaled(value, options.longPromptMultiplier),
					per_mill_tokens: value
				};
	return {
		cache_write_1h_input_tokens: rate(scaled(adjustedInput, 2n)),
		cache_write_5m_input_tokens: rate(scaled(adjustedInput, 5n, 4n)),
		cached_input_tokens: rate(scaled(adjustedInput, 1n, options.cacheReadDivisor)),
		input_tokens: rate(adjustedInput),
		output_tokens: rate(adjustedOutput)
	};
}

describe('Azure provider onboarding contract', () => {
	test('publishes the exact verified Azure target matrix without duplicates', () => {
		const expected = [
			...gptTargets('gpt-5.4-2026-03-05', '2026-03-05', gpt54Nodes, {
				model: 'gpt-5.4',
				pro: false
			}),
			...gptTargets('gpt-5.4-mini-2026-03-17', '2026-03-17', gpt54Nodes, {
				model: 'gpt-5.4-mini',
				pro: false
			}),
			...gptTargets('gpt-5.4-nano-2026-03-17', '2026-03-17', standardNodes, {
				model: 'gpt-5.4-nano',
				pro: false
			}),
			...gptTargets(
				'gpt-5.4-pro-2026-03-05',
				'2026-03-05',
				[
					['standard', 'global'],
					['standard', 'instant']
				],
				{ model: 'gpt-5.4-pro', pro: false, routeIds: ['azure-responses'] }
			),
			...gptTargets(
				'gpt-5.5-2026-04-23',
				'2026-04-24',
				[...standardNodes, ['fast', 'global'], ['fast', 'us']],
				{ model: 'gpt-5.5', pro: false }
			),
			...gptTargets('gpt-5.6-luna', '2026-07-09', [...standardNodes, ['flex', 'global']]),
			...gptTargets('gpt-5.6-sol', '2026-07-09', [
				...standardNodes,
				['standard', 'apac'],
				['flex', 'global'],
				['fast', 'global']
			]),
			...gptTargets('gpt-5.6-terra', '2026-07-09', [
				...standardNodes,
				['flex', 'global'],
				['fast', 'global']
			]),
			...gptTargets('gpt-6-astra', '2026-09-03', [...standardNodes, ['flex', 'global']]),
			...gptTargets('gpt-6-luna', '2026-09-22', [...standardNodes, ['flex', 'global']]),
			...gptTargets('gpt-6-sol', '2026-09-22', [
				...standardNodes,
				['flex', 'global'],
				['fast', 'global'],
				['fast', 'us']
			]),
			...gptTargets('gpt-6.1-sol', '2026-09-29', [
				...standardNodes,
				['standard', 'apac'],
				['flex', 'global']
			]),
			...gptTargets('gpt-6.1-terra', '2026-10-26', [...standardNodes, ['standard', 'apac']]),
			...otherTargets
		]
			.map((target) => ({ ...target, upstream: { serviceTier: 'standard', ...target.upstream } }))
			.sort((left, right) => left.id.localeCompare(right.id));
		const actual = azureDeployments()
			.map(([id, deployment]) => ({
				id,
				modelId: deployment.modelId,
				routeIds: Object.keys(deployment.routes).sort(),
				hosting: deployment.hosting,
				upstream: deployment.upstream
			}))
			.sort((left, right) => left.id.localeCompare(right.id));
		expect(actual).toEqual(expected);
		expect(new Set(actual.map(({ id }) => id)).size).toBe(actual.length);
	});

	test('keeps Azure BYOK-only and lists only its verified routes', () => {
		// Product names such as Azure OpenAI are not aliases; see the catalog alias rule.
		expect(catalog.graph.providers.azure).toEqual({
			// The Azure geographies that offer Foundry models, where a resource keeps data at rest.
			accountLocations: [
				...['AE', 'AT', 'AU', 'BE', 'BR', 'CA', 'CH', 'CL', 'DE', 'DK', 'ES', 'FI', 'FR', 'GB'],
				...['ID', 'IL', 'IN', 'IT', 'JP', 'KR', 'MX', 'MY', 'NO', 'NZ', 'PL', 'QA', 'SA', 'SE'],
				...['SG', 'TW', 'US', 'ZA', 'apac', 'europe']
			],
			aliases: [],
			credentialModes: ['byok'],
			headquarteredCountry: 'US',
			name: 'Azure',
			notes: []
		});
		expect(
			Object.entries(catalog.graph.routes)
				.filter(([, route]) => route.providerId === 'azure')
				.map(([id]) => id)
				.sort()
		).toEqual([
			'azure-anthropic-messages',
			'azure-batch-chat-completions',
			'azure-batch-responses',
			'azure-chat-completions',
			'azure-responses'
		]);
		expect(catalog.graph.providers.azure.credentialModes).toEqual(['byok']);
	});

	test('pins GPT prices and retirement for every Azure location, tier, and reasoning mode', () => {
		// Global input, cached input, and output prices; EU Data Zone price in tenths of Global;
		// retirement. US Data Zones cost 1.1 times Global and Asia Pacific Data Zones 1.2 times.
		const models = {
			'gpt-5.6-luna': [['0.2', '0.02', '1.2'], 11n, '2028-01-11'],
			'gpt-5.6-sol': [['4', '0.4', '20'], 11n, '2028-01-11'],
			'gpt-5.6-terra': [['2', '0.2', '12'], 11n, '2028-01-11'],
			'gpt-6-astra': [['10', '1', '50'], 12n, '2028-01-11'],
			'gpt-6-luna': [['0.1', '0.01', '0.5'], 12n, '2028-03-11'],
			'gpt-6-sol': [['2', '0.2', '10'], 12n, '2028-03-11'],
			'gpt-6.1-sol': [['2', '0.1', '10'], 12n, '2028-03-11'],
			'gpt-6.1-terra': [['1', '0.05', '5'], 12n, '2027-10-26']
		} as const;
		for (const [, deployment] of azureDeployments()) {
			if (!(deployment.modelId in models)) continue;
			const [rates, euTenths, retirement] = models[deployment.modelId as keyof typeof models];
			const { deploymentType, serviceTier } = deployment.upstream;
			const regionTenths =
				deploymentType === 'data_zone_standard_us'
					? 11n
					: deploymentType === 'data_zone_standard_apac'
						? 12n
						: deploymentType === 'data_zone_standard_eu'
							? euTenths
							: 10n;
			const [tierNumerator, tierDenominator] =
				serviceTier === 'fast' ? [2n, 1n] : serviceTier === 'flex' ? [1n, 2n] : [1n, 1n];
			expect(deployment.pricing).toEqual(
				gptPricing(rates, regionTenths * tierNumerator, 10n * tierDenominator)
			);
			expect(deployment.retirementDate).toBe(retirement);
			expect(deployment.contextWindowTokens).toBe(1_050_000);
			expect(deployment.maxOutputTokens).toBe(128_000);
			expect(deployment.reasoningMaxTokens).toBeNull();
			expect(
				Object.fromEntries(
					Object.entries(deployment.routes).map(([routeId, route]) => [
						routeId,
						route.reasoningEfforts
					])
				)
			).toEqual(
				deployment.upstream.reasoningMode === 'pro'
					? { 'azure-responses': allReasoningEfforts }
					: {
							'azure-chat-completions': chatReasoningEfforts,
							'azure-responses': allReasoningEfforts
						}
			);
		}
	});

	test('prices GPT-5.4 and gives it the windows that OpenAI does, with Data Zones above Global', () => {
		// Asia Pacific Data Zones cost 1.2 times Global, and the US and EU Data Zones 1.1 times.
		const zoneTenths = (deploymentType: string) =>
			deploymentType === 'data_zone_standard_apac'
				? 12n
				: deploymentType.startsWith('data_zone_')
					? 11n
					: 10n;
		let compared = 0;
		for (const [, deployment] of azureDeployments()) {
			const { deploymentType, serviceTier } = deployment.upstream;
			const tier = deploymentType.includes('batch')
				? '-batch'
				: serviceTier === 'standard'
					? ''
					: `-${serviceTier}`;
			const openai = catalog.graph.deployments[`openai-${deployment.modelId}${tier}`];
			if (!deployment.modelId.startsWith('gpt-5.4-') || !openai) continue;
			const tenths = zoneTenths(deploymentType);
			expect(deployment.pricing).toEqual(
				Object.fromEntries(
					Object.entries(openai.pricing as Record<string, Record<string, string>>).map(
						([meter, rates]) => [
							meter,
							Object.fromEntries(
								Object.entries(rates).map(([key, value]) => [key, scaled(value, tenths, 10n)])
							)
						]
					)
				)
			);
			expect([
				deployment.contextWindowTokens,
				deployment.maxInputTokens,
				deployment.maxOutputTokens
			]).toEqual([openai.contextWindowTokens, openai.maxInputTokens, openai.maxOutputTokens]);
			compared++;
		}
		// Every GPT-5.4 deployment but nano's, which OpenAI shuts down before the catalog's cutoff.
		expect(compared).toBe(20);
	});

	test('pins GPT-5.5 prices, windows, and retirement for every location and tier', () => {
		for (const [, deployment] of azureDeployments()) {
			if (deployment.modelId !== 'gpt-5.5-2026-04-23') continue;
			const zoneTenths = deployment.upstream.deploymentType.startsWith('data_zone_standard_')
				? 11n
				: 10n;
			if (deployment.upstream.serviceTier === 'fast') {
				// Priority has short prompt meters only, at 2.5 times the Standard rates.
				const rate = (value: string) => ({
					per_mill_tokens: scaled(value, zoneTenths * 25n, 100n)
				});
				expect(deployment.pricing).toEqual({
					cached_input_tokens: rate('0.5'),
					input_tokens: rate('5'),
					output_tokens: rate('30')
				});
				expect(deployment.contextWindowTokens).toBe(272_000);
			} else {
				const { cached_input_tokens, input_tokens, output_tokens } = gptPricing(
					['5', '0.5', '30'],
					zoneTenths,
					10n
				);
				expect(deployment.pricing).toEqual({ cached_input_tokens, input_tokens, output_tokens });
				expect(deployment.contextWindowTokens).toBe(922_000);
			}
			expect(deployment.retirementDate).toBe('2027-10-26');
		}
	});

	test('pins Claude hosting, reasoning, model-specific retention, and prices separately', () => {
		// Input, output, and the divisor that gives the cache read price from the input price.
		const prices = {
			'claude-fable-5': ['10', '50', 10n],
			'claude-fable-5-1': ['10', '50', 40n],
			'claude-fable-5-2': ['8', '40', 40n],
			'claude-haiku-5-5': ['0.1', '0.5', 10n],
			'claude-mythos-5': ['10', '50', 10n],
			'claude-mythos-5-1': ['10', '50', 40n],
			'claude-mythos-5-2': ['8', '40', 40n],
			'claude-opus-4-8': ['5', '25', 10n],
			'claude-opus-5-5': ['4', '20', 20n],
			'claude-sonnet-5-5': ['2', '10', 20n]
		} as const;
		for (const [, deployment] of azureDeployments()) {
			if (!(deployment.modelId in prices)) continue;
			const [input, output, cacheReadDivisor] = prices[deployment.modelId as keyof typeof prices];
			// Azure sells Fast as a model whose name ends in -fast, at twice the standard rates.
			const fast = deployment.upstream.serviceTier === 'fast';
			expect(fast).toBe(deployment.upstream.model === `${deployment.modelId}-fast`);
			const route = deployment.routes['azure-anthropic-messages'];
			expect(route.hostedTools.web_search.pricing).toEqual({
				anthropic_web_search_calls: { per_1k_calls: '10' }
			});
			expect(deployment.pricing).toEqual(
				claudePricing(fast ? scaled(input, 2n) : input, fast ? scaled(output, 2n) : output, {
					dataZone: deployment.upstream.deploymentType === 'data_zone_standard_us',
					cacheReadDivisor,
					// Haiku 5.5 charges five times every rate once the prompt is over 100K tokens.
					longPromptMultiplier: deployment.modelId === 'claude-haiku-5-5' ? 5n : undefined
				})
			);
			// Anthropic keeps what it runs for 30 days. Microsoft states no retention for what it runs.
			expect(route.dataHandling.retentionDays).toBe(deployment.hosting === 'anthropic' ? 30 : null);
			// Foundry offers no max effort for Claude Fable and Mythos.
			const fableOrMythos = /^claude-(?:fable|mythos)-/.test(deployment.modelId);
			expect(route.reasoningEfforts.includes('max')).toBe(
				!fableOrMythos && catalog.graph.models[deployment.modelId].reasoningEfforts.includes('max')
			);
		}
	});

	test('pins all non-GPT and non-Claude token prices', () => {
		const expected = {
			'azure-deepseek-v4-flash-0423': ['0.19', '0.028', '0.51'],
			'azure-deepseek-v4-flash-0423-eu': ['0.21', '0.031', '0.56'],
			'azure-deepseek-v4-flash-0423-us': ['0.21', '0.031', '0.56'],
			'azure-deepseek-v4-pro': ['1.74', '0.145', '3.48'],
			'azure-deepseek-v4-pro-us': ['1.91', '0.16', '3.83'],
			'azure-minimax-m3-fireworks-hosted-us': ['0.33', '0.066', '1.32']
		} as const;
		const deployments = catalog.graph.deployments;
		for (const [id, [input, cached, output]] of Object.entries(expected)) {
			expect(deployments[id as keyof typeof deployments].pricing).toEqual({
				cached_input_tokens: { per_mill_tokens: cached },
				input_tokens: { per_mill_tokens: input },
				output_tokens: { per_mill_tokens: output }
			});
		}
		// Azure publishes no cached input meter for gpt-oss-120b.
		expect(deployments['azure-gpt-oss-120b'].pricing).toEqual({
			input_tokens: { per_mill_tokens: '0.15' },
			output_tokens: { per_mill_tokens: '0.6' }
		});
		expect(deployments['azure-gpt-oss-120b-us'].pricing).toEqual({
			input_tokens: { per_mill_tokens: '0.165' },
			output_tokens: { per_mill_tokens: '0.66' }
		});
	});

	test('keeps public regions conservative and does not invent capacity-metered deployments', () => {
		for (const [, deployment] of azureDeployments()) {
			for (const { dataHandling: handling } of Object.values(deployment.routes)) {
				if (
					deployment.hosting === 'azure' &&
					deployment.upstream.deploymentType === 'data_zone_standard_us'
				) {
					expect(handling).toMatchObject({ processingLocation: 'US', storageLocation: 'US' });
				}
				if (
					deployment.hosting === 'azure' &&
					deployment.upstream.deploymentType === 'data_zone_standard_eu'
				) {
					expect(handling).toMatchObject({
						processingLocation: 'europe',
						storageLocation: 'europe'
					});
				}
				if (deployment.hosting === 'fireworks') {
					expect(handling).toMatchObject({
						processingLocation: 'US',
						retentionDays: null,
						storageLocation: 'unknown',
						trainingUse: null
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
			expect(catalog.graph.models[modelId]).toBeDefined();
			expect(azureModelIds.has(modelId)).toBe(false);
		}
	});
});
