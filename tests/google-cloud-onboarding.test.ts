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
	toolChoice: true
};
// Request and response logging is a project setting that no request can turn off.
const providerHandling: DataHandlingContract = {
	endToEndEncrypted: false,
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
	test('pins the Claude routes and every deployment', () => {
		assertProviderOnboardingContract(catalog, {
			provider: {
				aliases: ['gcp'],
				capabilities,
				credentialModes: ['byok'],
				dataHandling: providerHandling,
				companyId: 'google',
				headquarteredCountry: 'US',
				id: 'google-cloud',
				name: 'Google Cloud'
			},
			routes: [
				{
					documentFormats: formats,
					id: 'google-cloud-agent-platform-messages',
					inputModalities: ['text', 'image'],
					interfaces: ['chat_completions', 'responses']
				},
				{
					// Anthropic stores data in the US and deletes inputs and outputs within 30 days.
					dataHandling: { retentionDays: 30, storageLocation: 'US' },
					documentFormats: formats,
					hostedTools: anthropicHostedTools,
					id: 'google-cloud-anthropic-managed-messages',
					inputModalities: ['text', 'image'],
					interfaces: ['chat_completions', 'responses']
				},
				{
					capabilities: { streaming: false },
					// Message Batches results stay available for 29 days.
					dataHandling: { retentionDays: 29, storageLocation: 'US' },
					documentFormats: formats,
					hostedTools: anthropicHostedTools,
					id: 'google-cloud-anthropic-managed-message-batches',
					inputModalities: ['text', 'image'],
					interfaces: ['chat_completions', 'responses'],
					batch: true,
					stogasSupported: false
				}
			],
			deployments,
			// Anthropic's Fast mode page names Google Cloud for Opus 5.5 alone.
			anthropicHosted: anthropicHosted('google-cloud', platformModels, [
				'claude-fable-5-2',
				'claude-mythos-5-2',
				'claude-opus-5-5'
			]),
			// Claude Models on Google Cloud (Anthropic managed) stores data in the US.
			anthropicHostedDataHandling: { storageLocation: 'US' }
		});
	});
});
