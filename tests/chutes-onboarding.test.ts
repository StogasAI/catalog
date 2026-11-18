import { describe, test } from 'bun:test';
import { catalog } from './generated-catalog';
import {
	assertProviderOnboardingContract,
	type ProviderDeploymentContract
} from './provider-onboarding';

const capabilities = {
	functionCalling: true,
	parallelFunctionCalling: false,
	implicitPromptCaching: true,
	explicitPromptCaching: false,
	streaming: true,
	structuredOutputs: true,
	systemMessages: true,
	toolChoice: true,
	toolResultAttachments: false
};
const chuteIds: Record<string, string> = {
	'chutes-deepseek-v3.2': '398651e1-5f85-5e50-a513-7c5324e8e839',
	'chutes-deepseek-v4-flash-0731': 'b4d58772-e72b-55d1-9d73-d30dff6d2ed8',
	'chutes-gemma-4-31b': '42ee92ba-a537-5a73-8741-876067750db7',
	'chutes-glm-5.1': 'b048fe26-0352-5c46-acf7-335e527e7f3d',
	'chutes-glm-5.2': '08901219-159f-55a7-87cf-9d0d02744668',
	'chutes-kimi-k2.6': 'aac09863-35b4-5d9b-9b67-6e6a9d54273a',
	'chutes-kimi-k3': '0bb5d4c2-b5da-587d-b88e-62b4839028ec',
	'chutes-qwen3.5-27b': 'd24fc0ce-25e3-5377-8e8a-af99ee9bb70d',
	'chutes-qwen3.5-397b-a17b': '51a4284a-a5a0-5e44-a9cc-6af5a2abfbcf',
	'chutes-qwen3.6-27b': '7aa5e899-c0ba-5482-af48-d3f31d635c9f',
	'chutes-qwen3.8-27b': '9ecb73cc-909b-5334-9cd8-74985945cff5'
};
const gpuCounts: Record<string, number> = {
	'chutes-deepseek-v3.2': 8,
	'chutes-deepseek-v4-flash-0731': 8,
	'chutes-gemma-4-31b': 1,
	'chutes-glm-5.1': 8,
	'chutes-glm-5.2': 8,
	'chutes-kimi-k2.6': 8,
	'chutes-kimi-k3': 8,
	'chutes-qwen3.5-27b': 1,
	'chutes-qwen3.5-397b-a17b': 8,
	'chutes-qwen3.6-27b': 1,
	'chutes-qwen3.8-27b': 1
};
const dataHandling = {
	processingLocation: 'world',
	storageLocation: 'unknown',
	endToEndEncrypted: true,
	retentionDays: null,
	trainingUse: false,
	zeroDataRetention: false,
	tee: true,
	teeVerified: false
};
const deployments: ProviderDeploymentContract[] = [
	deployment(
		'chutes-qwen3.5-27b',
		'qwen3.5-27b',
		'alibaba',
		'Qwen/Qwen3.5-27B-TEE',
		262144,
		262144,
		'fp8',
		'0.2',
		'0.02',
		'1.75',
		true,
		['text', 'image', 'video'],
		'optional',
		[],
		null,
		{ contextWindowTokens: 1_010_000, maxOutputTokens: 1_010_000 }
	),
	deployment(
		'chutes-qwen3.5-397b-a17b',
		'qwen3.5-397b-a17b',
		'alibaba',
		'Qwen/Qwen3.5-397B-A17B-TEE',
		262144,
		65536,
		'fp8',
		'0.45',
		'0.045',
		'3',
		true,
		['text', 'image', 'video'],
		'optional',
		[],
		null,
		{ contextWindowTokens: 1_010_000, maxOutputTokens: 1_010_000 }
	),
	deployment(
		'chutes-gemma-4-31b',
		'gemma-4-31b',
		'google',
		'google/gemma-4-31B-turbo-TEE',
		131072,
		65536,
		'fp4',
		'0.12',
		'0.012',
		'0.37',
		true,
		['text', 'image', 'video'],
		'optional',
		[],
		null,
		{ contextWindowTokens: 262144, maxOutputTokens: 262144 }
	),
	deployment(
		'chutes-glm-5.1',
		'glm-5.1',
		'z-ai',
		'zai-org/GLM-5.1-TEE',
		202752,
		65535,
		'fp8',
		'0.9',
		'0.09',
		'2.9',
		true,
		['text'],
		'optional',
		[],
		null,
		{ maxOutputTokens: 131072 }
	),
	deployment(
		'chutes-deepseek-v3.2',
		'deepseek-v3.2',
		'deepseek',
		'deepseek-ai/DeepSeek-V3.2-TEE',
		131072,
		65536,
		'fp8',
		'1',
		'0.1',
		'1',
		true,
		['text'],
		'optional',
		[],
		null,
		{ contextWindowTokens: 131072, maxOutputTokens: 131072 }
	),
	deployment(
		'chutes-glm-5.2',
		'glm-5.2',
		'z-ai',
		'zai-org/GLM-5.2-TEE',
		1048576,
		65535,
		'fp4',
		'1.25',
		'0.125',
		'3.95',
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
		'alibaba',
		'Qwen/Qwen3.6-27B-TEE',
		262144,
		65536,
		'fp8',
		'0.25',
		'0.025',
		'2',
		true,
		['text', 'image', 'video'],
		'optional',
		[],
		null,
		{ contextWindowTokens: 1_010_000, maxOutputTokens: 1_010_000 }
	),
	deployment(
		'chutes-qwen3.8-27b',
		'qwen3.8-27b',
		'alibaba',
		'Qwen/Qwen3.8-27B-TEE',
		262144,
		65536,
		'fp8',
		'0.039',
		'0.0039',
		'1.25',
		true,
		['text', 'image', 'video'],
		'optional',
		['low', 'medium', 'xhigh'],
		null,
		{ contextWindowTokens: 1_000_000, maxOutputTokens: 1_000_000 }
	),
	deployment(
		'chutes-kimi-k2.6',
		'kimi-k2.6',
		'moonshot-ai',
		'moonshotai/Kimi-K2.6-TEE',
		262144,
		65535,
		'int4',
		'0.39',
		'0.039',
		'1.8',
		true,
		['text', 'image', 'video'],
		'optional',
		[],
		null,
		{ maxOutputTokens: 262144 }
	),
	deployment(
		'chutes-kimi-k3',
		'kimi-k3',
		'moonshot-ai',
		'moonshotai/Kimi-K3-TEE',
		1048576,
		65535,
		'mxfp4',
		'1.85',
		'0.185',
		'9.5',
		true,
		['text', 'image', 'video'],
		'required',
		['low', 'high', 'max'],
		null,
		{ maxOutputTokens: 1048576 }
	),
	{
		...deployment(
			'chutes-deepseek-v4-flash-0731',
			'deepseek-v4-flash-0731',
			'deepseek',
			'deepseek-ai/DeepSeek-V4-Flash-0731-TEE',
			1048576,
			131072,
			'fp8',
			'0.44',
			'0.044',
			'1.32',
			true,
			['text'],
			'optional',
			['low', 'high', 'max'],
			null,
			{ maxOutputTokens: 1048576 }
		),
		reasoningEfforts: ['high', 'max']
	},
	standard(
		'chutes-deepseek-v4.1-flash-1017-unknown-hosted',
		'deepseek-v4.1-flash-1017',
		'deepseek',
		'deepseek-ai/DeepSeek-V4.1-Flash-1017',
		'34c7b79d-854b-5e32-981a-774d322062b0',
		{ contextWindowTokens: 1_000_000, maxOutputTokens: 393216 },
		{
			contextWindowTokens: 1048576,
			inputModalities: ['text', 'image'],
			maxOutputTokens: 393216,
			reasoning: 'optional',
			reasoningEfforts: ['low', 'high', 'max']
		},
		['0.195', '0.02', '0.78'],
		{ structuredOutputs: false }
	),
	standard(
		'chutes-deepseek-v4-pro-0813-unknown-hosted',
		'deepseek-v4-pro-0813',
		'deepseek',
		'deepseek-ai/DeepSeek-V4-Pro-0813',
		'b990f27b-59b1-526e-adfd-e3ad9ea8920d',
		{ contextWindowTokens: 1_000_000, maxOutputTokens: 393216 },
		{
			contextWindowTokens: 1048576,
			inputModalities: ['text'],
			maxOutputTokens: 393216,
			reasoning: 'optional',
			reasoningEfforts: ['low', 'high', 'max']
		},
		['0.85', '0.15', '2.65']
	),
	standard(
		'chutes-glm-5.3-unknown-hosted',
		'glm-5.3',
		'z-ai',
		'zai-org/GLM-5.3',
		'1ebb4c96-21fb-5c6f-b5ab-d4aeaa869603',
		{ contextWindowTokens: 1048576, maxOutputTokens: 131072 },
		{
			inputModalities: ['text'],
			maxOutputTokens: 1048576,
			reasoning: 'required',
			reasoningEfforts: ['low', 'high', 'max']
		},
		['0.8', '0.16', '2.5'],
		{ structuredOutputs: false }
	),
	standard(
		'chutes-glm-5.2-unknown-hosted',
		'glm-5.2',
		'z-ai',
		'zai-org/GLM-5.2-Fast',
		'3200d3cc-6583-535b-b104-1f87c2397698',
		{ contextWindowTokens: 1048576, maxOutputTokens: 131072 },
		{
			inputModalities: ['text'],
			maxOutputTokens: 1048576,
			reasoning: 'optional',
			reasoningEfforts: ['high', 'max']
		},
		['2.45', '0.49', '7.7']
	),
	standard(
		'chutes-kimi-k2.7-code-unknown-hosted',
		'kimi-k2.7-code',
		'moonshot-ai',
		'moonshotai/Kimi-K2.7-Code',
		'36e54170-0e13-59b7-8aab-8ed348dabd49',
		{ contextWindowTokens: 262144, maxOutputTokens: 16384 },
		{ inputModalities: ['text', 'image', 'video'], maxOutputTokens: 262144, reasoning: 'required' },
		['0.832', '0.167', '3.5']
	),
	standard(
		'chutes-qwen3.8-2.4t-a95b-unknown-hosted',
		'qwen3.8-2.4t-a95b',
		'alibaba',
		'Qwen/Qwen3.8-2.4T-A95B',
		'd86bda6f-f327-538c-9e23-44f7372e1cb8',
		{ contextWindowTokens: 1_000_000, maxOutputTokens: 131072 },
		{
			contextWindowTokens: 1_010_000,
			inputModalities: ['text'],
			maxOutputTokens: 1_010_000,
			reasoning: 'required',
			reasoningEfforts: ['low', 'medium', 'xhigh']
		},
		['2', '0.25', '6'],
		{ structuredOutputs: false, toolChoice: false }
	),
	standard(
		'chutes-qwen3.8-max-0902-unknown-hosted',
		'qwen3.8-max-0902',
		'alibaba',
		'Qwen/Qwen3.8-Max-0902',
		'cb177979-3b79-5508-bcbe-5e7f3f5cec75',
		{ contextWindowTokens: 1000000, maxInputTokens: 991808, maxOutputTokens: 131072 },
		{ inputModalities: ['text', 'image', 'video'], reasoning: 'optional' },
		['2', '0.25', '6']
	),
	standard(
		'chutes-hy4-unknown-hosted',
		'hy4',
		'tencent',
		'tencent/Hy4',
		'718e99ae-99ee-5a46-8c1a-5d35a169e61f',
		{ contextWindowTokens: 1024000, maxInputTokens: 960000, maxOutputTokens: 64000 },
		{ inputModalities: ['text', 'image'], reasoning: 'optional' },
		['0.525', '0.025', '1.5625']
	)
];

describe('Chutes provider onboarding contract', () => {
	test('pins the complete model, price, route, and TEE surface', () => {
		assertProviderOnboardingContract(catalog, {
			deployments,
			provider: {
				aliases: [],
				capabilities,
				sampling: [
					'temperature',
					'topP',
					'topK',
					'frequencyPenalty',
					'presencePenalty',
					'repetitionPenalty',
					'seed'
				],
				stogasByok: true,
				stogasManaged: true,
				dataHandling,
				companyId: 'chutes',
				headquarteredCountry: 'US',
				id: 'chutes',
				name: 'Chutes'
			},
			routes: [
				{
					id: 'chutes-chat-completions',
					endpoint: 'https://api.chutes.ai/e2e/invoke',
					documentFormats: { extensions: [], mediaTypes: [] },
					inputModalities: ['text'],
					interfaces: ['chat_completions'],
					supportsCancellation: true,
					notes:
						"Independent network operators supply the GPUs. A model on several Hopper GPUs sends data between them over NVLink without encryption, through switches that Chutes' evidence does not cover."
				},
				{
					dataHandling: { endToEndEncrypted: false, trainingUse: null, tee: false },
					id: 'chutes-standard-chat-completions',
					endpoint: 'https://llm.chutes.ai/v1/chat/completions',
					documentFormats: { extensions: [], mediaTypes: [] },
					inputModalities: ['text'],
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
	modelFacts: { contextWindowTokens?: number; maxOutputTokens?: number } = {}
): ProviderDeploymentContract {
	const chuteId = chuteIds[id];
	const gpuCount = gpuCounts[id];
	return {
		authorId,
		capabilities: { ...capabilities, structuredOutputs },
		contextWindowTokens: contextTokens,
		id,
		inputModalities,
		maxOutputTokens: outputTokens,
		modelContextWindowTokens: modelFacts.contextWindowTokens,
		modelId,
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
		retirementDate: null,
		routeIds: ['chutes-chat-completions'],
		hosting: 'chutes',
		upstream: {
			chuteId,
			gpuCount,
			model: upstreamModel,
			serviceTier: 'standard'
		},
		weightPrecision
	};
}

// A Standard chute: Chutes relays it to an operator that it does not name, so no reasoning
// control reaches it and only the capabilities probed on it apply.
function standard(
	id: string,
	modelId: string,
	authorId: string,
	upstreamModel: string,
	chuteId: string,
	limits: { contextWindowTokens: number; maxInputTokens?: number; maxOutputTokens: number },
	model: {
		contextWindowTokens?: number;
		inputModalities: string[];
		maxOutputTokens?: number;
		reasoning: 'optional' | 'required';
		reasoningEfforts?: string[];
	},
	[input, cachedInput, output]: [string, string, string],
	unsupported: Record<string, false> = {}
): ProviderDeploymentContract {
	return {
		authorId,
		capabilities: { ...capabilities, ...unsupported },
		contextWindowTokens: limits.contextWindowTokens,
		id,
		inputModalities: model.inputModalities,
		maxInputTokens: limits.maxInputTokens,
		maxOutputTokens: limits.maxOutputTokens,
		modelId,
		modelContextWindowTokens: model.contextWindowTokens,
		modelMaxOutputTokens: model.maxOutputTokens,
		modelReasoning: model.reasoning,
		modelReasoningEfforts: model.reasoningEfforts ?? [],
		outputModalities: ['text'],
		pricing: {
			cached_input_tokens: { per_mill_tokens: cachedInput },
			input_tokens: { per_mill_tokens: input },
			output_tokens: { per_mill_tokens: output }
		},
		reasoningEfforts: [],
		retirementDate: null,
		routeIds: ['chutes-standard-chat-completions'],
		hosting: 'unknown',
		upstream: { chuteId, model: upstreamModel, serviceTier: 'standard' }
	};
}
