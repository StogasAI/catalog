import { describe, test } from 'bun:test';
import { catalog } from './generated-catalog';
import {
	anthropicHosted,
	claudeCapabilities,
	claudeModels,
	tokenPrices,
	type ClaudeModelId
} from './cloud-claude';
import {
	assertProviderOnboardingContract,
	type DataHandlingContract,
	type ProviderDeploymentContract,
	type ProviderRouteContract
} from './provider-onboarding';

const capabilities = {
	explicitPromptCaching: true,
	functionCalling: true,
	implicitPromptCaching: false,
	parallelFunctionCalling: true,
	streaming: true,
	structuredOutputs: true,
	systemMessages: true,
	toolChoice: true,
	toolResultAttachments: true
};
// In Bedrock's default data retention mode, AWS may keep data for safety and abuse prevention for
// a period that it does not state.
// AWS names the GovCloud Regions only in its FedRAMP and DoD authorizations of Bedrock.
const govCloudCertifications = [
	'fedramp-moderate',
	'fedramp-high',
	'dod-il2',
	'dod-il4',
	'dod-il5'
];
// Anthropic runs Claude Platform on AWS under its own audits.
const anthropicCertifications = ['soc2-type2', 'iso-27001', 'iso-42001'];
const providerHandling: DataHandlingContract = {
	// The audits in whose scope AWS names Amazon Bedrock.
	certifications: [
		'soc2-type2',
		'iso-27001',
		'iso-27017',
		'iso-27018',
		'iso-27701',
		'iso-42001',
		'pci-dss',
		'csa-star-level-2',
		'hipaa-eligible'
	],
	endToEndEncrypted: false,
	isolatedPromptCache: true,
	processingLocation: 'world',
	retentionDays: null,
	storageLocation: 'unknown',
	tee: false,
	teeVerified: false,
	trainingUse: false,
	zeroDataRetention: false
};

// Each model's Bedrock profile ID after its geography prefix, and its AWS prices: the global
// profile's first, then the US profile's, which cost 10 percent more.
const bedrock: Record<
	string,
	{ model: ClaudeModelId; profile: string; global: Prices; us: Prices }
> = {};
type Prices = Record<string, Record<string, string>>;
function offer(model: ClaudeModelId, profile: string, global: Prices, us: Prices) {
	bedrock[model] = { model, profile, global, us };
}
for (const model of ['claude-fable-5-2', 'claude-mythos-5-2'] as const)
	offer(
		model,
		`anthropic.${model}`,
		tokenPrices('8', '0.2', '10', '16', '40'),
		tokenPrices('8.8', '0.22', '11', '17.6', '44')
	);
offer(
	'claude-fable-5-1',
	'anthropic.claude-fable-5-1',
	tokenPrices('10', '0.25', '12.5', '20', '50'),
	tokenPrices('11', '0.275', '13.75', '22', '55')
);
offer(
	'claude-fable-5',
	'anthropic.claude-fable-5',
	tokenPrices('10', '1', '12.5', '20', '50'),
	tokenPrices('11', '1.1', '13.75', '22', '55')
);
offer(
	'claude-mythos-5-1',
	'anthropic.claude-mythos-5-1',
	tokenPrices('10', '0.25', '12.5', '20', '50'),
	tokenPrices('11', '0.275', '13.75', '22', '55')
);
offer(
	'claude-opus-5-5',
	'anthropic.claude-opus-5-5',
	tokenPrices('4', '0.2', '5', '8', '20'),
	tokenPrices('4.4', '0.22', '5.5', '8.8', '22')
);
for (const model of ['claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7'] as const)
	offer(
		model,
		`anthropic.${model}`,
		tokenPrices('5', '0.5', '6.25', '10', '25'),
		tokenPrices('5.5', '0.55', '6.875', '11', '27.5')
	);
offer(
	'claude-sonnet-5-5',
	'anthropic.claude-sonnet-5-5',
	tokenPrices('2', '0.1', '2.5', '4', '10'),
	tokenPrices('2.2', '0.11', '2.75', '4.4', '11')
);
// Its model card marks the Messages API unsupported, but the Messages API serves it.
offer(
	'claude-sonnet-4-6',
	'anthropic.claude-sonnet-4-6',
	tokenPrices('3', '0.3', '3.75', '6', '15'),
	tokenPrices('3.3', '0.33', '4.125', '6.6', '16.5')
);
offer(
	'claude-sonnet-5',
	'anthropic.claude-sonnet-5',
	tokenPrices('2', '0.2', '2.5', '4', '10'),
	tokenPrices('2.2', '0.22', '2.75', '4.4', '11')
);
offer(
	'claude-haiku-5-5',
	'anthropic.claude-haiku-5-5',
	tokenPrices('0.1', '0.01', '0.125', '0.2', '0.5', ['0.5', '0.05', '0.625', '1', '2.5']),
	tokenPrices('0.11', '0.011', '0.1375', '0.22', '0.55', ['0.55', '0.055', '0.6875', '1.1', '2.75'])
);
// Haiku 4.5 keeps its dated, versioned ID on Bedrock.
offer(
	'claude-haiku-4-5',
	'anthropic.claude-haiku-4-5-20251001-v1:0',
	tokenPrices('1', '0.1', '1.25', '2', '5'),
	tokenPrices('1.1', '0.11', '1.375', '2.2', '5.5')
);

// The other geographies of each model's profiles, which cost what the US profile does, and the
// place where each keeps inference.
const GEOGRAPHY_PLACES = { eu: 'eu', jp: 'JP', au: 'AU', in: 'IN', ca: 'CA' } as const;
const geographies: Partial<Record<ClaudeModelId, (keyof typeof GEOGRAPHY_PLACES)[]>> = {
	'claude-haiku-4-5': ['eu', 'jp', 'au', 'in'],
	'claude-haiku-5-5': ['eu', 'jp', 'au', 'ca'],
	'claude-opus-4-7': ['eu', 'jp', 'au'],
	'claude-opus-4-8': ['eu', 'jp', 'au'],
	'claude-opus-5': ['eu', 'au', 'in'],
	'claude-opus-5-5': ['eu', 'jp', 'au'],
	'claude-sonnet-4-6': ['eu', 'jp', 'au'],
	'claude-sonnet-5': ['eu', 'au', 'in'],
	'claude-sonnet-5-5': ['eu', 'au', 'ca']
};

// The models of the AWS GovCloud (US) profile, which costs 20 percent more than the global one.
// Stogas serves none of them, because the GovCloud Regions take only their own partition's accounts.
const govCloud: ClaudeModelId[] = [
	'claude-fable-5-1',
	'claude-fable-5-2',
	'claude-haiku-5-5',
	'claude-mythos-5-2',
	'claude-opus-4-8',
	'claude-opus-5',
	'claude-opus-5-5',
	'claude-sonnet-5',
	'claude-sonnet-5-5'
];
const fifthMore = (prices: Prices): Prices =>
	Object.fromEntries(
		Object.entries(prices).map(([meter, rates]) => [
			meter,
			Object.fromEntries(
				Object.entries(rates).map(([rate, usd]) => [
					rate,
					String(Number((Number(usd) * 1.2).toFixed(6)))
				])
			)
		])
	);

// Bedrock keeps nothing of a request to a model whose allowed modes include none, which every
// Claude model does but Fable and Mythos.
const kept = { retentionDays: 0, storageLocation: 'none', zeroDataRetention: true } as const;
// Fable needs the aws_review data retention mode, and Mythos needs it or provider_data_share. Under
// both, AWS keeps prompts and completions inside AWS for up to 30 days.
const review = (storageLocation: string) => ({
	retentionDays: 30,
	storageLocation,
	zeroDataRetention: false
});

function deployment(
	id: string,
	model: ClaudeModelId,
	upstream: Record<string, string>,
	dataHandling: Partial<DataHandlingContract>,
	pricing: Prices
): ProviderDeploymentContract {
	return {
		...claudeModels[model],
		capabilities: claudeCapabilities(model, capabilities),
		dataHandling: { ...providerHandling, ...kept, ...dataHandling },
		id,
		modelId: model,
		pricing,
		retirementDate: null,
		routeIds: ['aws-bedrock-messages'],
		hosting: 'amazon',
		upstream: { ...upstream, serviceTier: 'standard' }
	};
}

const deployments: ProviderDeploymentContract[] = Object.values(bedrock).flatMap(
	({ model, profile, global, us }) => {
		const reviewed = /^claude-(fable|mythos)-/.test(model);
		// Bedrock serves Mythos only to accounts that Anthropic's verification programs approve.
		const gated = model.startsWith('claude-mythos') ? { approvalRequired: true } : {};
		// Bedrock caches Claude Opus 4.7 prompts from 4,096 tokens, where Anthropic's API caches
		// them from 2,048.
		const cached = model === 'claude-opus-4-7' ? { promptCacheMinimumTokens: 4096 } : {};
		return [
			{
				...deployment(
					`aws-${model}`,
					model,
					{ inferenceGeo: 'global', model: `global.${profile}` },
					reviewed ? review('world') : {},
					global
				),
				...gated,
				...cached
			},
			{
				...deployment(
					`aws-${model}-us`,
					model,
					{ inferenceGeo: 'us', model: `us.${profile}` },
					{
						processingLocation: 'US',
						...(reviewed ? review('US') : {})
					},
					us
				),
				...gated,
				...cached
			},
			...(geographies[model] ?? []).map((geo) => ({
				...deployment(
					`aws-${model}-${geo}`,
					model,
					{ inferenceGeo: geo, model: `${geo}.${profile}` },
					{ processingLocation: GEOGRAPHY_PLACES[geo] },
					us
				),
				...cached
			})),
			...(govCloud.includes(model)
				? [
						{
							...deployment(
								`aws-${model}-us-gov`,
								model,
								{ inferenceGeo: 'us-gov', model: `us-gov.${profile}` },
								{
									certifications: govCloudCertifications,
									processingLocation: 'US',
									...(reviewed ? review('US') : {})
								},
								fifthMore(global)
							),
							...gated,
							stogasByok: false as const
						}
					]
				: [])
		];
	}
);
// Bedrock's batch inference, through the same profiles, for the models that AWS prices it for: input
// and output tokens only, at half of each profile's price. The customer's S3 buckets hold the
// requests and results, so where and for how long is unknown.
const batch: Partial<Record<ClaudeModelId, (keyof typeof GEOGRAPHY_PLACES | 'us' | 'us-gov')[]>> = {
	'claude-haiku-4-5': ['au', 'eu', 'in', 'jp', 'us'],
	'claude-opus-5': ['au', 'eu', 'in', 'us', 'us-gov'],
	'claude-sonnet-4-6': ['au', 'eu', 'jp', 'us']
};
const half = (prices: Prices) =>
	Object.fromEntries(
		['input_tokens', 'output_tokens'].map((meter) => [
			meter,
			{ per_mill_tokens: String(Number(prices[meter]!.per_mill_tokens) / 2) }
		])
	);
for (const [model, geos] of Object.entries(batch) as [ClaudeModelId, string[]][]) {
	const { profile, global, us } = bedrock[model]!;
	for (const geo of ['global', ...geos]) {
		const place = geo.startsWith('us')
			? 'US'
			: GEOGRAPHY_PLACES[geo as keyof typeof GEOGRAPHY_PLACES];
		deployments.push({
			...deployment(
				`aws-${model}-batch${geo === 'global' ? '' : `-${geo}`}`,
				model,
				{ inferenceGeo: geo, model: `${geo}.${profile}` },
				{
					...(geo === 'us-gov' ? { certifications: govCloudCertifications } : {}),
					...(place ? { processingLocation: place } : {}),
					retentionDays: null,
					storageLocation: 'unknown',
					zeroDataRetention: false
				},
				half(geo === 'global' ? global : geo === 'us-gov' ? fifthMore(global) : us)
			),
			capabilities: { ...claudeCapabilities(model, capabilities), streaming: false },
			routeIds: ['aws-bedrock-batch-messages']
		});
	}
}
// Claude Platform on AWS is Anthropic's own API, so each of its deployments serves what Anthropic's
// does. It offers every model of the Claude API but Mythos, without Fast mode.
const platformModels = (Object.keys(claudeModels) as ClaudeModelId[]).filter(
	(model) => !model.startsWith('claude-mythos')
);

// Only Claude Platform on AWS runs web search and web fetch, on both of its routes.
const platformHostedTools: ProviderRouteContract['hostedTools'] = [
	{
		dataHandling: { processingLocation: 'unknown' },
		pricing: { anthropic_web_search_calls: { per_1k_calls: '10' } },
		tool: 'web_search'
	},
	{
		dataHandling: {
			processingLocation: 'unknown',
			retentionDays: null,
			storageLocation: 'unknown',
			zeroDataRetention: false,
			// Website publishers receive the URLs that the tool fetches.
			sharedWith: ['unknown']
		},
		tool: 'web_fetch'
	}
];
const formats = {
	extensions: ['.csv', '.md', '.pdf', '.txt'],
	mediaTypes: ['application/pdf', 'text/plain']
};

describe('AWS onboarding contract', () => {
	test('pins the Claude routes and every deployment', () => {
		assertProviderOnboardingContract(catalog, {
			provider: {
				accountOptions: [
					{
						dataHandling: { retentionDays: 0, storageLocation: 'none', zeroDataRetention: true },
						grants: [],
						group: null,
						id: 'zero-data-retention',
						name: 'Zero data retention for Claude Platform on AWS',
						routes: ['aws-claude-platform-messages']
					},
					{
						dataHandling: {},
						grants: ['hipaa'],
						group: null,
						id: 'business-associate-agreement',
						name: 'Business associate agreement',
						routes: ['aws-bedrock-batch-messages', 'aws-bedrock-messages']
					}
				],
				aliases: [],
				capabilities,
				sampling: ['temperature', 'topP', 'topK'],
				stogasByok: true,
				stogasManaged: false,
				dataHandling: providerHandling,
				companyId: 'amazon',
				headquarteredCountry: 'US',
				id: 'aws',
				name: 'AWS'
			},
			routes: [
				{
					documentFormats: formats,
					inputLimits: {
						requestBytes: 20000000,
						images: { bytes: 3750000, count: 600, pixels: 8000 },
						documents: { pages: 600 }
					},
					dataHandling: kept,
					id: 'aws-bedrock-messages',
					inputModalities: ['text', 'image'],
					interfaces: ['chat_completions', 'responses']
				},
				{
					capabilities: { streaming: false },
					documentFormats: formats,
					id: 'aws-bedrock-batch-messages',
					inputModalities: ['text', 'image'],
					interfaces: ['chat_completions', 'responses'],
					batch: true
				},
				{
					// Anthropic deletes inputs and outputs within 30 days.
					dataHandling: { certifications: anthropicCertifications, retentionDays: 30 },
					documentFormats: formats,
					hostedTools: platformHostedTools,
					inputLimits: {
						requestBytes: 32000000,
						images: { count: 600, pixels: 8000 },
						documents: { pages: 600 }
					},
					id: 'aws-claude-platform-messages',
					inputModalities: ['text', 'image'],
					interfaces: ['chat_completions', 'responses']
				},
				{
					capabilities: { streaming: false },
					// Message Batches results stay available for 29 days.
					dataHandling: { certifications: anthropicCertifications, retentionDays: 29 },
					documentFormats: formats,
					hostedTools: platformHostedTools,
					id: 'aws-claude-platform-message-batches',
					inputModalities: ['text', 'image'],
					interfaces: ['chat_completions', 'responses'],
					batch: true
				}
			],
			deployments,
			anthropicHosted: anthropicHosted('aws', platformModels),
			// Anthropic's business associate agreement does not name Claude Platform on AWS.
			anthropicHostedDataHandling: { certifications: anthropicCertifications }
		});
	});
});
