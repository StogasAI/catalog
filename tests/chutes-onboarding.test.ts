import { describe, test } from 'bun:test';
import publicCatalog from '../generated/catalog.public.json';
import runtimeCatalog from '../generated/catalog.runtime.json';
import {
	assertProviderOnboardingContract,
	type ProviderDeploymentContract
} from './provider-onboarding';

const tee = {
	externalNetworkEgress: 'blocked' as const,
	mechanism: 'tdx',
	status: 'claimed'
};
const chuteReleases: Record<string, ProviderDeploymentContract['chuteRelease']> = {
	'chutes-deepseek-v3.2': release(
		'398651e1-5f85-5e50-a513-7c5324e8e839',
		'84768bae-013b-51b6-a99b-a540f8ce6b22',
		'a7e62ac04ecb2c0a54d736dc46601c5606cf10a6',
		'd63d064c-4add-5213-b278-d3125c8078fd',
		'sglang',
		'nightly-2026031300',
		'0.6.6'
	),
	'chutes-deepseek-v4-flash-0731': release(
		'b4d58772-e72b-55d1-9d73-d30dff6d2ed8',
		'cc993f19-2928-5b19-b23a-1a842dc9e17e',
		'7eb21d27aee405755da5251f4458e9fff87c047b',
		'c9041c08-cde6-5413-a67c-303ede8cf8d7',
		'sglang',
		'0.5.16',
		'0.6.11.rc2'
	),
	'chutes-gemma-4-31b-turbo': release(
		'42ee92ba-a537-5a73-8741-876067750db7',
		'db1c0111-8692-59e1-935c-e25e8c19bbcc',
		'4135a98a9b728a548947683219633b25682223ac',
		'a3028618-6f8f-5afc-9a51-8eff25f2e5c8',
		'sglang',
		'0.5.13-post1c',
		'0.6.11.rc2'
	),
	'chutes-glm-5.1': release(
		'b048fe26-0352-5c46-acf7-335e527e7f3d',
		'418df640-eb81-5e55-9827-9816fb4f98b9',
		'f396cf805182f4ca10fa675e1a99815b3ca384db',
		'ae476f71-ed8f-562e-b1af-49d49c948d6f',
		'sglang',
		'nightly-2026032100',
		'0.6.6'
	),
	'chutes-glm-5.2': release(
		'08901219-159f-55a7-87cf-9d0d02744668',
		'cc44b944-4f69-56b8-a4bc-afeaf7a222bf',
		'aec724e8c7b8ee9db3b48c01c320f63f9cdaf8aa',
		'e5589f58-64d3-51f6-8a3d-146b1cd77940',
		'sglang',
		'0.5.15-post1a',
		'0.6.11.rc2'
	),
	'chutes-kimi-k2.6': release(
		'aac09863-35b4-5d9b-9b67-6e6a9d54273a',
		'ce8c3085-6e7a-5bf0-8556-b0741b89ec7e',
		'd9cb81bc88b9bd2dc89877599f23c614ded72b9c',
		'5bbb13bc-c050-518d-bb55-79994b540ec2',
		'vllm',
		'nightly-2026031400',
		'0.6.6'
	),
	'chutes-kimi-k3': release(
		'0bb5d4c2-b5da-587d-b88e-62b4839028ec',
		'005ad26b-6994-54e3-a70b-49521b0d4e8b',
		'301be1b88c89c0d3a763da6301352cb8fe399e90',
		'aa5068c9-72cf-5af6-9045-d7e52193e36f',
		'sglang',
		'0.5.16-k3a',
		'0.6.11.rc2'
	),
	'chutes-mistral-nemo-instruct-2407': release(
		'7725a31d-28df-5bb7-9d29-c23b49df5472',
		'3fe0aeb0-9da2-58cf-9e2d-4e6ec72288b1',
		'e9976040f42d8a5590ed58cefe973061b3f973b5',
		'e8a097de-bebd-5dfe-b69f-532a6c06a57e',
		'sglang',
		'nightly-2026050600',
		'0.6.8'
	),
	'chutes-nemotron-3-nano-omni-30b': release(
		'761ccdab-2e3d-5268-ab03-55f8ba94a80c',
		'2df88df6-d97c-5270-bf45-777d06e867d6',
		'd15962741057ae3a07147df504060e9f0838224e',
		'e41a2e2f-9822-58e6-a330-3d5901115a99',
		'nemotronomni',
		'0.2.1',
		'0.6.5'
	),
	'chutes-qwen3-235b-a22b-thinking-2507': release(
		'21d129e5-8426-5c29-a6be-844e0f5f5e30',
		'f62fb4b6-54ee-5eaf-81c2-a6429df9c4a2',
		'4cd68849b2a0fadb84866c703b133aa8c8636130',
		'd4708900-a2b1-5f8d-bd7b-a260a72606ba',
		'vllm',
		'nightly-2026030502',
		'0.5.17'
	),
	'chutes-qwen3-32b': release(
		'ac059e33-eb27-541c-b9a9-24b214036475',
		'd2573964-caf0-54cb-b8f6-0897ca370da9',
		'aa55da1ecc13d006e8b8e4f54579b1ea8c3db2df',
		'a3028618-6f8f-5afc-9a51-8eff25f2e5c8',
		'sglang',
		'0.5.13-post1c',
		'0.6.11.rc2'
	),
	'chutes-qwen3.5-397b-a17b': release(
		'51a4284a-a5a0-5e44-a9cc-6af5a2abfbcf',
		'5b6f2243-de55-5f34-b607-82c2f44eed22',
		'9f1f3de9a3a48cfd340fd73ca98c02625b7afb3b',
		'cc46d5fd-9059-59f4-b208-83ff6ff11c31',
		'sglang',
		'0.5.13-post1b',
		'0.6.11.rc2'
	),
	'chutes-qwen3.6-27b': release(
		'7aa5e899-c0ba-5482-af48-d3f31d635c9f',
		'50e83e9b-87d6-5586-adea-5591bd8d95fc',
		'e89b16ebf1988b3d6befa7de50abc2d76f26eb09',
		'a3028618-6f8f-5afc-9a51-8eff25f2e5c8',
		'sglang',
		'0.5.13-post1c',
		'0.6.11.rc2'
	)
};
const dataHandling = {
	processingRegions: ['multi-region'],
	retentionDays: null,
	storageRegions: [],
	trainingUse: false,
	zeroDataRetention: false
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
		'52000000000000000',
		'416000000000000000'
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
		'225000000000000000',
		'3000000000000000000',
		true,
		['text', 'image']
	),
	deployment(
		'chutes-gemma-4-31b-turbo',
		'gemma-4-31b-turbo',
		'google',
		'google/gemma-4-31B-turbo-TEE',
		131072,
		65536,
		'nvfp4',
		'120000000000000000',
		'60000000000000000',
		'370000000000000000',
		true,
		['text', 'image']
	),
	deployment(
		'chutes-glm-5.1',
		'glm-5.1',
		'z-ai',
		'zai-org/GLM-5.1-TEE',
		202752,
		65535,
		'fp8',
		'980000000000000000',
		'490000000000000000',
		'3080000000000000000'
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
		'500000000000000000',
		'1000000000000000000'
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
		'625000000000000000',
		'3950000000000000000',
		true,
		['text'],
		['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
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
		'150000000000000000',
		'2000000000000000000',
		true,
		['text', 'image']
	),
	deployment(
		'chutes-kimi-k2.6',
		'kimi-k2.6',
		'moonshot-ai',
		'moonshotai/Kimi-K2.6-TEE',
		262144,
		65535,
		'int4',
		'660000000000000000',
		'330000000000000000',
		'3500000000000000000',
		true,
		['text', 'image', 'video']
	),
	deployment(
		'chutes-qwen3-235b-a22b-thinking-2507',
		'qwen3-235b-a22b-thinking-2507',
		'qwen',
		'Qwen/Qwen3-235B-A22B-Thinking-2507-TEE',
		262144,
		262144,
		'bf16',
		'298900000000000000',
		'149450000000000000',
		'1195700000000000000'
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
		'12250000000000000',
		'97800000000000000',
		false
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
		'1500000000000000000',
		'15000000000000000000',
		true,
		['text', 'image', 'video']
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
			'12250000000000000',
			'97800000000000000',
			false,
			['text', 'image', 'audio', 'video']
		),
		externalNetworkEgress: 'allowed'
	},
	deployment(
		'chutes-deepseek-v4-flash-0731',
		'deepseek-v4-flash-0731',
		'deepseek',
		'deepseek-ai/DeepSeek-V4-Flash-0731-TEE',
		1048576,
		131072,
		'fp8',
		'140000000000000000',
		'70000000000000000',
		'280000000000000000'
	)
];

describe('Chutes provider onboarding contract', () => {
	test('pins the complete model, price, route, and TEE surface', () => {
		assertProviderOnboardingContract(runtimeCatalog, publicCatalog, {
			dataHandling,
			deployments,
			moderated: false,
			providerId: 'chutes',
			route: {
				capabilities: {
					cancellation: true,
					functionCalling: true,
					parallelFunctionCalling: false,
					pdfInput: false,
					promptCaching: true,
					streaming: true,
					structuredOutputs: true,
					systemMessages: true,
					toolChoice: true,
					urlContext: false,
					webSearch: false
				},
				endpoint: 'https://llm.chutes.ai/v1/chat/completions',
				id: 'chutes-chat-completions',
				interfaces: ['chat_completions']
			},
			tee
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
	modelReasoningEfforts: string[] = []
): ProviderDeploymentContract {
	return {
		aliases: [`${modelId}-tee`],
		authorId,
		capabilities: { functionCalling: true, structuredOutputs },
		chuteRelease: chuteReleases[id],
		contextWindowTokens: contextTokens,
		id,
		inputModalities,
		maxOutputTokens: outputTokens,
		modelId,
		modelReasoningEfforts,
		pricing: {
			cached_input_tokens: { per_mill_tokens: cachedInput },
			input_tokens: { per_mill_tokens: input },
			output_tokens: { per_mill_tokens: output }
		},
		upstreamModel,
		weightPrecision
	};
}

function release(
	chuteId: string,
	chuteVersion: string,
	modelRevision: string,
	imageId: string,
	imageName: string,
	imageTag: string,
	runtimeVersion: string
): ProviderDeploymentContract['chuteRelease'] {
	return {
		chuteId,
		chuteVersion,
		imageId,
		imageName,
		imageTag,
		modelRevision,
		runtimeVersion
	};
}
