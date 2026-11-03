import { describe, test } from 'bun:test';
import { catalog } from './generated-catalog';
import { claudeModels, tokenPrices, type ClaudeModelId } from './cloud-claude';
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
		routeIds: ['aws-messages'],
		upstream: { ...upstream, serviceTier: 'standard' }
	};
}

const deployments: ProviderDeploymentContract[] = Object.values(bedrock).flatMap(
	({ model, profile, global, us }) => {
		// Fable needs AWS review, under which AWS keeps prompts and completions for 30 days.
		const kept = model.startsWith('claude-fable');
		return [
			deployment(
				`aws-${model}`,
				model,
				{ hosting: 'aws', inferenceGeo: 'global', model: `global.${profile}` },
				kept ? { retentionDays: 30, storageLocation: 'world' } : {},
				global
			),
			deployment(
				`aws-${model}-us`,
				model,
				{ hosting: 'aws', inferenceGeo: 'us', model: `us.${profile}` },
				{
					processingLocation: 'US',
					...(kept ? { retentionDays: 30, storageLocation: 'US' } : {})
				},
				us
			)
		];
	}
);
// Anthropic keeps the prompts of Claude Platform on AWS for 30 days in a place it does not name.
deployments.push(
	deployment(
		'aws-claude-fable-5-1-anthropic-hosted',
		'claude-fable-5-1',
		{ hosting: 'anthropic', inferenceGeo: 'global', model: 'claude-fable-5-1' },
		{ retentionDays: 30, storageLocation: 'unknown' },
		bedrock['claude-fable-5-1']!.global
	)
);

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
