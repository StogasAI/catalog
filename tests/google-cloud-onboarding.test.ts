import { describe, test } from 'bun:test';
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
const globalPrices = {
	cache_write_1h_input_tokens: { per_mill_tokens: '20' },
	cache_write_5m_input_tokens: { per_mill_tokens: '12.5' },
	cached_input_tokens: { per_mill_tokens: '0.25' },
	input_tokens: { per_mill_tokens: '10' },
	output_tokens: { per_mill_tokens: '50' }
};
// The us and eu endpoints cost 10 percent more than the global one.
const regionalPrices = {
	cache_write_1h_input_tokens: { per_mill_tokens: '22' },
	cache_write_5m_input_tokens: { per_mill_tokens: '13.75' },
	cached_input_tokens: { per_mill_tokens: '0.275' },
	input_tokens: { per_mill_tokens: '11' },
	output_tokens: { per_mill_tokens: '55' }
};

function fable(
	id: string,
	upstream: Record<string, string>,
	dataHandling: Partial<DataHandlingContract>,
	pricing: Record<string, Record<string, string>>
): ProviderDeploymentContract {
	return {
		authorId: 'anthropic',
		capabilities,
		contextWindowTokens: 1_000_000,
		dataHandling: { ...providerHandling, ...dataHandling },
		id,
		inputModalities: ['text', 'image'],
		maxOutputTokens: 128_000,
		modelId: 'claude-fable-5-1',
		modelReasoning: 'required',
		modelReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
		outputModalities: ['text'],
		pricing,
		retirementDate: null,
		routeIds: ['google-cloud-messages'],
		upstream: { ...upstream, model: 'claude-fable-5-1', serviceTier: 'standard' }
	};
}

// Anthropic keeps the prompts of its own offering for 30 days in a place it does not name.
const deployments: ProviderDeploymentContract[] = [
	fable(
		'google-cloud-claude-fable-5-1',
		{ hosting: 'google', inferenceGeo: 'global' },
		{},
		globalPrices
	),
	fable(
		'google-cloud-claude-fable-5-1-eu',
		{ hosting: 'google', inferenceGeo: 'eu' },
		{ processingLocation: 'eu' },
		regionalPrices
	),
	fable(
		'google-cloud-claude-fable-5-1-us',
		{ hosting: 'google', inferenceGeo: 'us' },
		{ processingLocation: 'US' },
		regionalPrices
	),
	fable(
		'google-cloud-claude-fable-5-1-anthropic-hosted',
		{ hosting: 'anthropic', inferenceGeo: 'global' },
		{ retentionDays: 30 },
		globalPrices
	)
];

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
				}
			],
			deployments
		});
	});
});
