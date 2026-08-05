import { describe, expect, test } from 'bun:test';
import publicCatalog from '../generated/catalog.public.json';
import runtimeCatalog from '../generated/catalog.runtime.json';
import {
	assertProviderOnboardingContract,
	type ProviderDeploymentContract
} from './provider-onboarding';

const capabilities = {
	cancellation: true,
	functionCalling: true,
	parallelFunctionCalling: true,
	pdfInput: false,
	implicitPromptCaching: true,
	explicitPromptCaching: false,
	streaming: true,
	structuredOutputs: true,
	systemMessages: true,
	toolChoice: true,
	urlContext: false,
	webSearch: false
};
const dataHandling = {
	processingRegions: ['multi-region'],
	retentionDays: 30,
	storageRegions: [],
	trainingUse: false,
	zeroDataRetention: false
};
const reasoningEfforts = ['low', 'medium', 'high', 'xhigh', 'max'];

function deployment(
	tier: 'luna' | 'sol' | 'terra',
	input: string,
	output: string
): ProviderDeploymentContract {
	const modelId = `gpt-5.6-${tier}`;
	const twiceInput = (BigInt(input) * 2n).toString();
	const cached = (BigInt(input) / 10n).toString();
	const longCached = (BigInt(cached) * 2n).toString();
	const cacheWrite = ((BigInt(input) * 5n) / 4n).toString();
	const longCacheWrite = (BigInt(cacheWrite) * 2n).toString();
	const longOutput = ((BigInt(output) * 3n) / 2n).toString();
	return {
		aliases: [],
		authorId: 'openai',
		capabilities,
		contextWindowTokens: 1_050_000,
		deprecationDate: null,
		id: `azure-${modelId}`,
		inputModalities: ['text', 'image'],
		maxOutputTokens: 128_000,
		modelId,
		modelReasoningAvailability: 'optional',
		modelReasoningEfforts: reasoningEfforts,
		outputModalities: ['text'],
		pricing: {
			cache_write_input_tokens: {
				per_mill_context_gt_272k: longCacheWrite,
				per_mill_context_lte_272k: cacheWrite
			},
			cached_input_tokens: {
				per_mill_context_gt_272k: longCached,
				per_mill_context_lte_272k: cached
			},
			input_tokens: {
				per_mill_context_gt_272k: twiceInput,
				per_mill_context_lte_272k: input
			},
			output_tokens: {
				per_mill_context_gt_272k: longOutput,
				per_mill_context_lte_272k: output
			}
		},
		routeIds: ['azure-chat-completions', 'azure-responses'],
		upstream: { model: modelId }
	};
}

describe('Azure provider onboarding contract', () => {
	test('pins the modern Azure OpenAI and Azure AI Foundry model surface', () => {
		assertProviderOnboardingContract(runtimeCatalog, publicCatalog, {
			deployments: [
				deployment('sol', '5000000000000000000', '30000000000000000000'),
				deployment('terra', '2000000000000000000', '12000000000000000000'),
				deployment('luna', '200000000000000000', '1200000000000000000')
			],
			provider: {
				aliases: ['azure-ai-foundry', 'azure-openai'],
				capabilities,
				credentialModes: ['byok'],
				dataHandling,
				headquarteredCountry: 'US',
				id: 'azure',
				moderated: true,
				name: 'Azure'
			},
			routes: [
				{
					id: 'azure-chat-completions',
					interfaces: ['chat_completions']
				},
				{
					id: 'azure-responses',
					interfaces: ['responses']
				}
			]
		});
	});

	test('intersects model and route capabilities for each native Azure route', () => {
		for (const deploymentId of ['azure-gpt-5.6-luna', 'azure-gpt-5.6-sol', 'azure-gpt-5.6-terra']) {
			const deployment = runtimeCatalog.graph.deployments[deploymentId];
			expect(deployment.capabilities.implicitPromptCaching).toBe(true);
			expect(deployment.capabilities.explicitPromptCaching).toBe(false);
			expect(deployment.routeIds).toEqual(['azure-chat-completions', 'azure-responses']);
		}

		expect(
			runtimeCatalog.graph.deployments['openai-gpt-5.6-sol'].capabilities.explicitPromptCaching
		).toBe(true);
	});
});
