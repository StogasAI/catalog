import { describe, test } from 'bun:test';
import publicCatalog from '../generated/catalog.public.json';
import runtimeCatalog from '../generated/catalog.runtime.json';
import {
	assertProviderOnboardingContract,
	type ProviderDeploymentContract
} from './provider-onboarding';

const capabilities = {
	cancellation: true,
	functionCalling: true,
	parallelFunctionCalling: false,
	pdfInput: false,
	implicitPromptCaching: true,
	explicitPromptCaching: false,
	streaming: true,
	structuredOutputs: true,
	systemMessages: true,
	toolChoice: true,
	urlContext: false
};
const chuteIds: Record<string, string> = {
	'chutes-deepseek-v3.2': '398651e1-5f85-5e50-a513-7c5324e8e839',
	'chutes-deepseek-v4-flash-0731': 'b4d58772-e72b-55d1-9d73-d30dff6d2ed8',
	'chutes-gemma-4-31b-turbo': '42ee92ba-a537-5a73-8741-876067750db7',
	'chutes-glm-5.1': 'b048fe26-0352-5c46-acf7-335e527e7f3d',
	'chutes-glm-5.2': '08901219-159f-55a7-87cf-9d0d02744668',
	'chutes-kimi-k2.6': 'aac09863-35b4-5d9b-9b67-6e6a9d54273a',
	'chutes-kimi-k3': '0bb5d4c2-b5da-587d-b88e-62b4839028ec',
	'chutes-mistral-nemo-instruct-2407': '7725a31d-28df-5bb7-9d29-c23b49df5472',
	'chutes-nemotron-3-nano-omni-30b': '761ccdab-2e3d-5268-ab03-55f8ba94a80c',
	'chutes-qwen3-32b': 'ac059e33-eb27-541c-b9a9-24b214036475',
	'chutes-qwen3.5-397b-a17b': '51a4284a-a5a0-5e44-a9cc-6af5a2abfbcf',
	'chutes-qwen3.6-27b': '7aa5e899-c0ba-5482-af48-d3f31d635c9f',
	'chutes-qwen3.8-27b': '9ecb73cc-909b-5334-9cd8-74985945cff5'
};
const gpuCounts: Record<string, number> = {
	'chutes-deepseek-v3.2': 8,
	'chutes-deepseek-v4-flash-0731': 8,
	'chutes-gemma-4-31b-turbo': 1,
	'chutes-glm-5.1': 8,
	'chutes-glm-5.2': 8,
	'chutes-kimi-k2.6': 8,
	'chutes-kimi-k3': 8,
	'chutes-mistral-nemo-instruct-2407': 1,
	'chutes-nemotron-3-nano-omni-30b': 1,
	'chutes-qwen3-32b': 8,
	'chutes-qwen3.5-397b-a17b': 8,
	'chutes-qwen3.6-27b': 1,
	'chutes-qwen3.8-27b': 1
};
const dataHandling = {
	processingLocation: 'global',
	storageLocation: 'none',
	endToEndEncrypted: true,
	retentionDays: 0,
	trainingUse: false,
	zeroDataRetention: true,
	tee: true,
	teeVerified: false
};
const deployments: ProviderDeploymentContract[] = [
	deployment(
		'chutes-qwen3-32b',
		'qwen3-32b',
		'qwen',
		'Qwen/Qwen3-32B-TEE',
		40960,
		40960,
		'fp8',
		'104000000000000000',
		'10400000000000000',
		'416000000000000000',
		true,
		['text'],
		'optional',
		[],
		null,
		{ contextWindowTokens: 131072, maxOutputTokens: 131072 }
	),
	deployment(
		'chutes-qwen3.5-397b-a17b',
		'qwen3.5-397b-a17b',
		'qwen',
		'Qwen/Qwen3.5-397B-A17B-TEE',
		262144,
		65536,
		'fp8',
		'450000000000000000',
		'45000000000000000',
		'3000000000000000000',
		true,
		['text', 'image'],
		'optional',
		[],
		null,
		{
			contextWindowTokens: 1_010_000,
			inputModalities: ['text', 'image', 'video'],
			maxOutputTokens: 1_010_000
		}
	),
	{
		...deployment(
			'chutes-gemma-4-31b-turbo',
			'gemma-4-31b',
			'google',
			'google/gemma-4-31B-turbo-TEE',
			131072,
			65536,
			'nvfp4',
			'120000000000000000',
			'12000000000000000',
			'370000000000000000',
			true,
			['text', 'image'],
			'optional',
			[],
			null,
			{
				contextWindowTokens: 262144,
				inputModalities: ['text', 'image', 'video'],
				maxOutputTokens: 262144
			}
		),
		aliases: ['gemma-4-31b-turbo-tee']
	},
	deployment(
		'chutes-glm-5.1',
		'glm-5.1',
		'z-ai',
		'zai-org/GLM-5.1-TEE',
		202752,
		65535,
		'fp8',
		'980000000000000000',
		'98000000000000000',
		'3080000000000000000',
		true,
		['text'],
		'optional',
		[],
		null,
		{ maxOutputTokens: 202752 }
	),
	deployment(
		'chutes-deepseek-v3.2',
		'deepseek-v3.2',
		'deepseek',
		'deepseek-ai/DeepSeek-V3.2-TEE',
		131072,
		65536,
		'fp8',
		'1000000000000000000',
		'100000000000000000',
		'1000000000000000000',
		true,
		['text'],
		'optional',
		[],
		null,
		{ contextWindowTokens: 163840, maxOutputTokens: 163840 }
	),
	deployment(
		'chutes-glm-5.2',
		'glm-5.2',
		'z-ai',
		'zai-org/GLM-5.2-TEE',
		1048576,
		65535,
		'nvfp4',
		'1250000000000000000',
		'125000000000000000',
		'3950000000000000000',
		true,
		['text'],
		'optional',
		['high', 'max'],
		null,
		{ maxOutputTokens: 1048576 }
	),
	deployment(
		'chutes-qwen3.6-27b',
		'qwen3.6-27b',
		'qwen',
		'Qwen/Qwen3.6-27B-TEE',
		262144,
		65536,
		'fp8',
		'300000000000000000',
		'30000000000000000',
		'2000000000000000000',
		true,
		['text', 'image'],
		'optional',
		[],
		null,
		{
			contextWindowTokens: 1_010_000,
			inputModalities: ['text', 'image', 'video'],
			maxOutputTokens: 1_010_000
		}
	),
	deployment(
		'chutes-qwen3.8-27b',
		'qwen3.8-27b',
		'qwen',
		'Qwen/Qwen3.8-27B-TEE',
		262144,
		65536,
		'fp8',
		'350000000000000000',
		'35000000000000000',
		'2750000000000000000',
		true,
		['text', 'image'],
		'optional',
		['low', 'medium', 'xhigh'],
		null,
		{
			contextWindowTokens: 1_000_000,
			inputModalities: ['text', 'image', 'video'],
			maxOutputTokens: 1_000_000
		}
	),
	deployment(
		'chutes-kimi-k2.6',
		'kimi-k2.6',
		'moonshot-ai',
		'moonshotai/Kimi-K2.6-TEE',
		262144,
		65535,
		'int4',
		'580000000000000000',
		'58000000000000000',
		'3400000000000000000',
		true,
		['text', 'image', 'video'],
		'optional',
		[],
		null,
		{ maxOutputTokens: 262144 }
	),
	deployment(
		'chutes-mistral-nemo-instruct-2407',
		'mistral-nemo-instruct-2407',
		'mistral-ai',
		'unsloth/Mistral-Nemo-Instruct-2407-TEE',
		131072,
		131072,
		'bf16',
		'24500000000000000',
		'2450000000000000',
		'97800000000000000'
	),
	deployment(
		'chutes-kimi-k3',
		'kimi-k3',
		'moonshot-ai',
		'moonshotai/Kimi-K3-TEE',
		1048576,
		65535,
		'mxfp4',
		'3000000000000000000',
		'300000000000000000',
		'15000000000000000000',
		true,
		['text', 'image', 'video'],
		'required',
		['low', 'high', 'max'],
		null,
		{ maxOutputTokens: 1048576 }
	),
	{
		...deployment(
			'chutes-nemotron-3-nano-omni-30b',
			'nemotron-3-nano-omni-30b',
			'nvidia',
			'Nemotron-3-Nano-Omni-30B-TEE',
			131072,
			131072,
			'bf16',
			'24500000000000000',
			'2450000000000000',
			'97800000000000000',
			true,
			['text', 'image', 'audio', 'video'],
			'optional',
			[],
			{ maximum: 262143, minimum: 1 },
			{ contextWindowTokens: 262144, maxOutputTokens: 262144 }
		),
		reasoningMaxTokens: null,
		publicOverrides: {
			contextWindowTokens: 131072,
			maxOutputTokens: 131072,
			reasoningMaxTokens: null
		}
	},
	{
		...deployment(
			'chutes-deepseek-v4-flash-0731',
			'deepseek-v4-flash-0731',
			'deepseek',
			'deepseek-ai/DeepSeek-V4-Flash-0731-TEE',
			1048576,
			131072,
			'fp8',
			'440000000000000000',
			'44000000000000000',
			'1320000000000000000',
			true,
			['text'],
			'optional',
			['low', 'high', 'max'],
			null,
			{ maxOutputTokens: 1048576 }
		),
		reasoningEfforts: ['high', 'max'],
		publicOverrides: {
			maxOutputTokens: 131072,
			reasoningEfforts: ['high', 'max']
		}
	}
];

describe('Chutes provider onboarding contract', () => {
	test('pins the complete model, price, route, and TEE surface', () => {
		assertProviderOnboardingContract(runtimeCatalog, publicCatalog, {
			deployments,
			provider: {
				aliases: [],
				capabilities,
				credentialModes: ['managed', 'byok'],
				dataHandling,
				id: 'chutes',
				name: 'Chutes'
			},
			routes: [
				{
					endpoint: 'https://api.chutes.ai/e2e/invoke',
					id: 'chutes-chat-completions',
					interfaces: ['chat_completions']
				}
			]
		});
	});
});

function deployment(
	id: string,
	modelId: string,
	authorId: string,
	upstreamModel: string,
	contextTokens: number,
	outputTokens: number,
	weightPrecision: string,
	input: string,
	cachedInput: string,
	output: string,
	structuredOutputs = true,
	inputModalities = ['text'],
	modelReasoning: 'optional' | 'required' | 'unsupported' = 'unsupported',
	modelReasoningEfforts: string[] = [],
	modelReasoningMaxTokens: { maximum: number; minimum: number } | null = null,
	modelFacts: {
		contextWindowTokens?: number;
		inputModalities?: string[];
		maxOutputTokens?: number;
	} = {}
): ProviderDeploymentContract {
	const chuteId = chuteIds[id];
	const gpuCount = gpuCounts[id];
	const publicOverrides = {
		...(modelFacts.contextWindowTokens !== undefined &&
		modelFacts.contextWindowTokens !== contextTokens
			? { contextWindowTokens: contextTokens }
			: {}),
		...(modelFacts.maxOutputTokens !== undefined && modelFacts.maxOutputTokens !== outputTokens
			? { maxOutputTokens: outputTokens }
			: {}),
		...(modelFacts.inputModalities &&
		modelFacts.inputModalities.join(',') !== inputModalities.join(',')
			? { inputModalities }
			: {})
	};
	return {
		aliases: [`${modelId}-tee`],
		authorId,
		capabilities: { ...capabilities, structuredOutputs },
		contextWindowTokens: contextTokens,
		deprecationDate: null,
		id,
		inputModalities,
		maxOutputTokens: outputTokens,
		modelContextWindowTokens: modelFacts.contextWindowTokens,
		modelId,
		modelInputModalities: modelFacts.inputModalities,
		modelMaxOutputTokens: modelFacts.maxOutputTokens,
		modelReasoning,
		modelReasoningEfforts,
		modelReasoningMaxTokens,
		outputModalities: ['text'],
		pricing: {
			cached_input_tokens: { per_mill_tokens: cachedInput },
			input_tokens: { per_mill_tokens: input },
			output_tokens: { per_mill_tokens: output }
		},
		...(Object.keys(publicOverrides).length > 0 ? { publicOverrides } : {}),
		routeIds: ['chutes-chat-completions'],
		upstream: { chuteId, gpuCount, model: upstreamModel },
		weightPrecision
	};
}
