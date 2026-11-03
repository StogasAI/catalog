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
// Bedrock neither stores nor logs prompts unless the account turns on invocation logging.
const providerHandling: DataHandlingContract = {
	endToEndEncrypted: false,
	processingLocation: 'world',
	retentionDays: 0,
	storageLocation: 'none',
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
// The US inference profile costs 10 percent more than the global one.
const usPrices = {
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
		routeIds: ['aws-messages'],
		upstream: { ...upstream, serviceTier: 'standard' }
	};
}

// AWS keeps Bedrock prompts and completions for 30 days to detect abuse; Anthropic keeps those of
// Claude Platform on AWS for 30 days in a place it does not name.
const deployments: ProviderDeploymentContract[] = [
	fable(
		'aws-claude-fable-5-1',
		{ hosting: 'aws', inferenceGeo: 'global', model: 'global.anthropic.claude-fable-5-1' },
		{ retentionDays: 30, storageLocation: 'world' },
		globalPrices
	),
	fable(
		'aws-claude-fable-5-1-us',
		{ hosting: 'aws', inferenceGeo: 'us', model: 'us.anthropic.claude-fable-5-1' },
		{ processingLocation: 'US', retentionDays: 30, storageLocation: 'US' },
		usPrices
	),
	fable(
		'aws-claude-fable-5-1-anthropic-hosted',
		{ hosting: 'anthropic', inferenceGeo: 'global', model: 'claude-fable-5-1' },
		{ retentionDays: 30, storageLocation: 'unknown' },
		globalPrices
	)
];

describe('AWS onboarding contract', () => {
	test('pins the Claude route and every deployment', () => {
		assertProviderOnboardingContract(catalog, {
			provider: {
				aliases: [],
				capabilities,
				credentialModes: ['byok'],
				dataHandling: providerHandling,
				headquarteredCountry: 'US',
				id: 'aws',
				name: 'AWS'
			},
			routes: [
				{
					documentFormats: {
						extensions: ['.csv', '.md', '.pdf', '.txt'],
						mediaTypes: ['application/pdf', 'text/plain']
					},
					// Only Claude Platform on AWS runs web search and web fetch.
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
					id: 'aws-messages',
					inputModalities: ['text', 'image'],
					interfaces: ['chat_completions', 'responses']
				}
			],
			deployments
		});
	});
});
