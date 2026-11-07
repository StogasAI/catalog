import { describe, test } from 'bun:test';
import { anthropicHosted, claudeModels, tokenPrices, type ClaudeModelId } from './cloud-claude';
import { catalog } from './generated-catalog';
import {
	assertProviderOnboardingContract,
	type DataHandlingContract,
	type ProviderDeploymentContract
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
		capabilities,
		dataHandling: { ...providerHandling, ...dataHandling },
		id,
		modelId: model,
		pricing,
		retirementDate: null,
		routeIds: ['google-cloud-messages'],
		upstream: { ...upstream, model, serviceTier: 'standard' }
	};
}

const deployments: ProviderDeploymentContract[] = agentPlatform.flatMap(
	({ model, global, regional }) => [
		deployment(
			`google-cloud-${model}`,
			model,
			{ hosting: 'google', inferenceGeo: 'global' },
			{},
			global
		),
		...(regional
			? [
					deployment(
						`google-cloud-${model}-eu`,
						model,
						{ hosting: 'google', inferenceGeo: 'eu' },
						{ processingLocation: 'eu' },
						regional
					),
					deployment(
						`google-cloud-${model}-us`,
						model,
						{ hosting: 'google', inferenceGeo: 'us' },
						{ processingLocation: 'US' },
						regional
					)
				]
			: [])
	]
);
// Claude on Google Cloud (Anthropic managed) is Anthropic's own API, so each of its deployments
// serves what Anthropic's does. Mythos and Fast mode are not listed yet.
const platformModels = (Object.keys(claudeModels) as ClaudeModelId[]).filter(
	(model) => !model.startsWith('claude-mythos')
);

describe('Google Cloud onboarding contract', () => {
	test('pins the Claude route and every deployment', () => {
		assertProviderOnboardingContract(catalog, {
			provider: {
				aliases: ['gcp'],
				capabilities,
				credentialModes: ['byok'],
				dataHandling: providerHandling,
				headquarteredCountry: 'US',
				id: 'google-cloud',
				name: 'Google Cloud'
			},
			routes: [
				{
					documentFormats: {
						extensions: ['.csv', '.md', '.pdf', '.txt'],
						mediaTypes: ['application/pdf', 'text/plain']
					},
					// Only Anthropic's own offering runs web search and web fetch.
					hostedTools: [
						{
							dataHandling: { processingLocation: 'unknown' },
							hostings: ['anthropic'],
							pricing: { anthropic_web_search_calls: { per_1k_calls: '10' } },
							tool: 'web_search'
						},
						{
							dataHandling: {
								processingLocation: 'unknown',
								retentionDays: null,
								storageLocation: 'unknown',
								zeroDataRetention: false
							},
							hostings: ['anthropic'],
							tool: 'web_fetch'
						}
					],
					id: 'google-cloud-messages',
					inputModalities: ['text', 'image'],
					interfaces: ['chat_completions', 'responses']
				},
				{
					capabilities: { streaming: false },
					documentFormats: {
						extensions: ['.csv', '.md', '.pdf', '.txt'],
						mediaTypes: ['application/pdf', 'text/plain']
					},
					hostedTools: [
						{
							dataHandling: { processingLocation: 'unknown' },
							hostings: ['anthropic'],
							pricing: { anthropic_web_search_calls: { per_1k_calls: '10' } },
							tool: 'web_search'
						},
						{
							dataHandling: {
								processingLocation: 'unknown',
								retentionDays: null,
								storageLocation: 'unknown',
								zeroDataRetention: false
							},
							hostings: ['anthropic'],
							tool: 'web_fetch'
						}
					],
					id: 'google-cloud-batch-messages',
					inputModalities: ['text', 'image'],
					interfaces: ['chat_completions', 'responses'],
					batch: true,
					stogasUnsupported: 'The gateway has no batch API and serves each request as it arrives.'
				}
			],
			deployments,
			// Anthropic's Fast mode page names Google Cloud for Opus 5.5 alone.
			anthropicHosted: anthropicHosted('google-cloud', platformModels, ['claude-opus-5-5'])
		});
	});
});
