import { describe, test } from 'bun:test';
import {
	anthropicHosted,
	claudeCapabilities,
	claudeModels,
	tokenPrices,
	type ClaudeModelId
} from './cloud-claude';
import { catalog } from './generated-catalog';
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
	toolResultImages: true,
	toolResultDocuments: true
};
// Request and response logging is a project setting that no request can turn off.
// Anthropic runs its managed routes under its own audits.
const anthropicCertifications = ['soc2-type2', 'iso-27001', 'iso-42001'];
const providerHandling: DataHandlingContract = {
	// The audits in whose scope Google Cloud names generative AI on Agent Platform, which still
	// apply to a partner model that it runs as a managed API.
	certifications: [
		'soc2-type2',
		'iso-27001',
		'iso-27017',
		'iso-27018',
		'iso-27701',
		'iso-42001',
		'pci-dss',
		'csa-star-level-2'
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
type Prices = Record<string, Record<string, string>>;

// Agent Platform's prices for each model: the global endpoint's first, then the us and eu
// multi-regions', which cost 10 percent more. Older models have no multi-region endpoint.
const agentPlatform: { model: ClaudeModelId; global: Prices; regional?: Prices }[] = [
	{
		model: 'claude-fable-5-2',
		global: tokenPrices('8', '0.2', '10', '16', '40'),
		regional: tokenPrices('8.8', '0.22', '11', '17.6', '44')
	},
	{
		model: 'claude-fable-5-1',
		global: tokenPrices('10', '0.25', '12.5', '20', '50'),
		regional: tokenPrices('11', '0.275', '13.75', '22', '55')
	},
	{
		model: 'claude-fable-5',
		global: tokenPrices('10', '1', '12.5', '20', '50'),
		regional: tokenPrices('11', '1.1', '13.75', '22', '55')
	},
	{
		model: 'claude-opus-5-5',
		global: tokenPrices('4', '0.2', '5', '8', '20'),
		regional: tokenPrices('4.4', '0.22', '5.5', '8.8', '22')
	},
	...(['claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7'] as const).map((model) => ({
		model,
		global: tokenPrices('5', '0.5', '6.25', '10', '25'),
		regional: tokenPrices('5.5', '0.55', '6.875', '11', '27.5')
	})),
	{
		model: 'claude-sonnet-5-5',
		global: tokenPrices('2', '0.1', '2.5', '4', '10'),
		regional: tokenPrices('2.2', '0.11', '2.75', '4.4', '11')
	},
	{
		model: 'claude-sonnet-5',
		global: tokenPrices('2', '0.2', '2.5', '4', '10'),
		regional: tokenPrices('2.2', '0.22', '2.75', '4.4', '11')
	},
	{
		model: 'claude-haiku-5-5',
		global: tokenPrices('0.1', '0.01', '0.125', '0.2', '0.5', ['0.5', '0.05', '0.625', '1', '2.5']),
		regional: tokenPrices('0.11', '0.011', '0.1375', '0.22', '0.55', [
			'0.55',
			'0.055',
			'0.6875',
			'1.1',
			'2.75'
		])
	},
	...(['claude-opus-4-6', 'claude-opus-4-5'] as const).map((model) => ({
		model,
		global: tokenPrices('5', '0.5', '6.25', '10', '25')
	})),
	{ model: 'claude-sonnet-4-6', global: tokenPrices('3', '0.3', '3.75', '6', '15') },
	{ model: 'claude-haiku-4-5', global: tokenPrices('1', '0.1', '1.25', '2', '5') }
];

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
		dataHandling: { ...providerHandling, ...dataHandling },
		id,
		modelId: model,
		pricing,
		retirementDate: null,
		routeIds: ['google-cloud-agent-platform-messages'],
		hosting: 'google',
		// Google shares Fable's prompts and responses with Anthropic to monitor abuse.
		...(model.startsWith('claude-fable-') ? { sharedWith: ['anthropic'] } : {}),
		upstream: { ...upstream, model, serviceTier: 'standard' }
	};
}

// Google keeps Fable's prompts and responses for up to 30 days to monitor abuse.
const kept = (model: ClaudeModelId) =>
	model.startsWith('claude-fable-') ? { retentionDays: 30 } : {};
const deployments: ProviderDeploymentContract[] = agentPlatform.flatMap(
	({ model, global, regional }) => [
		deployment(`google-cloud-${model}`, model, { inferenceGeo: 'global' }, kept(model), global),
		...(regional
			? [
					deployment(
						`google-cloud-${model}-eu`,
						model,
						{ inferenceGeo: 'eu' },
						{ processingLocation: 'eu', ...kept(model) },
						regional
					),
					deployment(
						`google-cloud-${model}-us`,
						model,
						{ inferenceGeo: 'us' },
						{ processingLocation: 'US', ...kept(model) },
						regional
					)
				]
			: [])
	]
);
// Gemini on Agent Platform: what Google states for each model, and its prices at the global
// endpoint, then at the us and eu multi-regions, which cost 10 percent more.
const geminiCapabilities = {
	explicitPromptCaching: false,
	functionCalling: true,
	implicitPromptCaching: true,
	parallelFunctionCalling: true,
	streaming: true,
	structuredOutputs: true,
	systemMessages: true,
	toolChoice: true,
	// Core sends a tool result to Gemini as text.
	toolResultImages: false,
	toolResultDocuments: false
};
const geminiPrices = (input: string, cacheRead: string, output: string) => ({
	cached_input_tokens: { per_mill_tokens: cacheRead },
	input_tokens: { per_mill_tokens: input },
	output_tokens: { per_mill_tokens: output }
});
// Google ignores custom sampling on Gemini 4 and states nothing about its penalties or seed.
const gemini4Sampling = [
	'temperature',
	'topP',
	'topK',
	'frequencyPenalty',
	'presencePenalty',
	'seed'
];
const gemini: {
	model: string;
	efforts: string[];
	global: Prices;
	regional: Prices;
	approvalRequired?: true;
	withoutSampling: string[];
	withoutInputModalities?: string[];
}[] = [
	{
		model: 'gemini-4-carbon',
		efforts: ['low', 'medium', 'high'],
		global: geminiPrices('4', '0.2', '20'),
		regional: geminiPrices('4.4', '0.22', '22'),
		approvalRequired: true,
		withoutSampling: gemini4Sampling
	},
	{
		model: 'gemini-4-argon',
		efforts: ['low', 'medium', 'high'],
		global: geminiPrices('4', '0.2', '20'),
		regional: geminiPrices('4.4', '0.22', '22'),
		withoutSampling: gemini4Sampling
	},
	{
		model: 'gemini-4-hydrogen',
		efforts: ['low', 'medium', 'high', 'xhigh'],
		global: geminiPrices('1.5', '0.075', '7.5'),
		regional: geminiPrices('1.65', '0.082', '8.25'),
		withoutSampling: gemini4Sampling
	},
	{
		model: 'gemini-4-neon',
		efforts: ['low', 'medium', 'high', 'xhigh'],
		global: geminiPrices('3', '0.15', '15'),
		regional: geminiPrices('3.3', '0.165', '16.5'),
		approvalRequired: true,
		withoutSampling: gemini4Sampling
	},
	{
		model: 'gemini-3.8-flash',
		efforts: ['low', 'medium', 'high'],
		global: geminiPrices('1.5', '0.15', '7.5'),
		regional: geminiPrices('1.65', '0.165', '8.25'),
		withoutSampling: ['temperature', 'topP', 'topK', 'frequencyPenalty', 'presencePenalty']
	},
	{
		model: 'gemini-3.5-flash',
		efforts: ['minimal', 'low', 'medium', 'high'],
		global: geminiPrices('1.5', '0.15', '9'),
		regional: geminiPrices('1.65', '0.165', '9.9'),
		withoutSampling: ['topK']
	},
	{
		model: 'gemini-3.5-flash-lite',
		efforts: ['minimal', 'low', 'medium', 'high'],
		global: geminiPrices('0.3', '0.03', '2.5'),
		regional: geminiPrices('0.33', '0.033', '2.75'),
		withoutSampling: ['temperature', 'topP', 'topK', 'frequencyPenalty', 'presencePenalty']
	},
	{
		model: 'gemini-3.1-flash-lite',
		efforts: ['minimal', 'low', 'medium', 'high'],
		global: geminiPrices('0.25', '0.025', '1.5'),
		regional: geminiPrices('0.275', '0.027', '1.65'),
		withoutSampling: ['topK'],
		// Google charges twice the text price for audio, which the catalog cannot price.
		withoutInputModalities: ['audio']
	}
];
for (const { model, efforts, global, regional, ...facts } of gemini) {
	const gemini4 = model.startsWith('gemini-4');
	for (const [geo, place] of [['global'], ['eu', 'eu'], ['us', 'US']] as const) {
		deployments.push({
			...facts,
			authorId: 'google',
			capabilities: geminiCapabilities,
			contextWindowTokens: 1048576,
			dataHandling: { ...providerHandling, ...(place ? { processingLocation: place } : {}) },
			hosting: 'google',
			id: `google-cloud-${model}${geo === 'global' ? '' : `-${geo}`}`,
			inputModalities: ['text', 'image', 'audio', 'video'],
			// One reply on v1 is one foreground segment of Gemini 4.
			maxOutputTokens: 65536,
			modelId: model,
			modelMaxOutputTokens: gemini4 ? 1048576 : 65536,
			modelReasoning: 'required',
			modelReasoningEfforts: efforts,
			outputModalities: ['text'],
			pricing: geo === 'global' ? global : regional,
			retirementDate: null,
			routeIds: ['google-cloud-agent-platform-generate-content'],
			upstream: { inferenceGeo: geo, model, serviceTier: 'standard' }
		});
	}
}
// Claude on Google Cloud (Anthropic managed) is Anthropic's own API, so each of its deployments
// serves what Anthropic's does. Of the Mythos models, Anthropic lists only Mythos 5.2 there.
const platformModels = (Object.keys(claudeModels) as ClaudeModelId[]).filter(
	(model) => !model.startsWith('claude-mythos') || model === 'claude-mythos-5-2'
);

// Only Anthropic's own offering runs web search and web fetch.
const anthropicHostedTools: ProviderRouteContract['hostedTools'] = [
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

describe('Google Cloud onboarding contract', () => {
	test('pins every route and deployment', () => {
		assertProviderOnboardingContract(catalog, {
			provider: {
				accountOptions: [
					{
						dataHandling: { retentionDays: 0, storageLocation: 'none', zeroDataRetention: true },
						grants: [],
						group: null,
						id: 'zero-data-retention',
						name: 'Zero data retention for Claude Models on Google Cloud (Anthropic managed)',
						routes: ['google-cloud-anthropic-managed-messages']
					}
				],
				aliases: ['gcp'],
				capabilities,
				sampling: ['temperature', 'topP', 'topK'],
				stogasByok: true,
				stogasManaged: false,
				dataHandling: providerHandling,
				companyId: 'google',
				headquarteredCountry: 'US',
				id: 'google-cloud',
				name: 'Google Cloud'
			},
			routes: [
				{
					documentFormats: formats,
					inputLimits: {
						requestBytes: 30000000,
						images: { bytes: 7500000, count: 600, pixels: 8000 },
						documents: { pages: 600 }
					},
					id: 'google-cloud-agent-platform-messages',
					inputModalities: ['text', 'image'],
					interfaces: ['chat_completions', 'responses']
				},
				{
					// Anthropic stores data in the US and deletes inputs and outputs within 30 days.
					dataHandling: {
						certifications: anthropicCertifications,
						retentionDays: 30,
						storageLocation: 'US'
					},
					documentFormats: formats,
					hostedTools: anthropicHostedTools,
					inputLimits: {
						requestBytes: 32000000,
						images: { count: 600, pixels: 8000 },
						documents: { pages: 600 }
					},
					id: 'google-cloud-anthropic-managed-messages',
					inputModalities: ['text', 'image'],
					interfaces: ['chat_completions', 'responses']
				},
				{
					capabilities: { streaming: false },
					// Message Batches results stay available for 29 days.
					dataHandling: {
						certifications: anthropicCertifications,
						retentionDays: 29,
						storageLocation: 'US'
					},
					documentFormats: formats,
					hostedTools: anthropicHostedTools,
					id: 'google-cloud-anthropic-managed-message-batches',
					inputModalities: ['text', 'image'],
					interfaces: ['chat_completions', 'responses'],
					batch: true
				},
				{
					capabilities: geminiCapabilities,
					documentFormats: {
						extensions: ['.pdf', '.txt'],
						mediaTypes: ['application/pdf', 'text/plain']
					},
					inputLimits: { images: { count: 3000 }, documents: { count: 3000 } },
					id: 'google-cloud-agent-platform-generate-content',
					inputModalities: ['text', 'image', 'audio'],
					interfaces: ['chat_completions'],
					sampling: ['temperature', 'topP', 'topK', 'frequencyPenalty', 'presencePenalty', 'seed']
				}
			],
			deployments,
			// Anthropic's Fast mode page names Google Cloud for Opus 5.5 alone.
			anthropicHosted: anthropicHosted('google-cloud', platformModels, [
				'claude-fable-5-2',
				'claude-mythos-5-2',
				'claude-opus-5-5'
			]),
			// Claude Models on Google Cloud (Anthropic managed) stores data in the US, and Anthropic's
			// business associate agreement does not name it.
			anthropicHostedDataHandling: {
				certifications: anthropicCertifications,
				storageLocation: 'US'
			}
		});
	});
});
