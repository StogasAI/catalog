import type { ProviderDeploymentContract } from './provider-onboarding';

const efforts = ['low', 'medium', 'high', 'xhigh', 'max'];
const budget = (maximum: number) => ({ maximum, minimum: 1024 });

/** The model facts that every cloud deployment of a Claude model shares. */
export const claudeModels = {
	'claude-fable-5-2': model(1_000_000, 128_000, 'required', efforts),
	'claude-fable-5-1': model(1_000_000, 128_000, 'required', efforts),
	'claude-fable-5': model(1_000_000, 128_000, 'required', efforts),
	'claude-mythos-5-2': model(1_000_000, 128_000, 'required', efforts),
	'claude-mythos-5-1': model(1_000_000, 128_000, 'required', efforts),
	'claude-opus-5-5': model(1_000_000, 128_000, 'required', efforts),
	'claude-opus-5': model(1_000_000, 128_000, 'optional', efforts),
	'claude-opus-4-8': model(1_000_000, 128_000, 'optional', efforts),
	'claude-opus-4-7': model(1_000_000, 128_000, 'optional', efforts),
	'claude-opus-4-6': model(
		1_000_000,
		128_000,
		'optional',
		['low', 'medium', 'high', 'max'],
		127_999
	),
	'claude-opus-4-5': model(200_000, 64_000, 'optional', ['low', 'medium', 'high'], 63_999),
	'claude-sonnet-5-5': model(1_000_000, 128_000, 'required', efforts),
	'claude-sonnet-5': model(1_000_000, 128_000, 'optional', efforts),
	'claude-sonnet-4-6': model(
		1_000_000,
		128_000,
		'optional',
		['low', 'medium', 'high', 'max'],
		127_999
	),
	'claude-haiku-5-5': model(1_000_000, 128_000, 'optional', efforts),
	'claude-haiku-4-5': model(200_000, 64_000, 'optional', [], 63_999)
} as const;
export type ClaudeModelId = keyof typeof claudeModels;

// The Claude models that refuse a forced tool choice wherever they run.
const forcedToolChoiceRefused = new Set<ClaudeModelId>([
	'claude-fable-5-2',
	'claude-fable-5-1',
	'claude-mythos-5-2',
	'claude-mythos-5-1',
	'claude-opus-5-5',
	'claude-sonnet-5-5'
]);

/** A route's capabilities as a deployment of the model serves them. */
export function claudeCapabilities(model: ClaudeModelId, capabilities: Record<string, boolean>) {
	return forcedToolChoiceRefused.has(model) ? { ...capabilities, toolChoice: false } : capabilities;
}

/**
 * The deployments that Anthropic runs on a cloud: each model at Standard, at Fast for the models
 * in `fast`, and through the Message Batches API, globally and, from Claude 4.6, with US-only
 * inference.
 */
export function anthropicHosted(
	providerId: string,
	models: readonly ClaudeModelId[],
	fast: readonly ClaudeModelId[] = []
) {
	const usOnly = new Set(['claude-opus-4-5', 'claude-haiku-4-5']);
	return models.flatMap((model) =>
		['', ...(fast.includes(model) ? ['-fast'] : []), '-batch'].flatMap((variant) =>
			['', ...(usOnly.has(model) ? [] : ['-us'])].map(
				(geo) => `${providerId}-${model}-anthropic-hosted${variant}${geo}`
			)
		)
	);
}

function model(
	contextWindowTokens: number,
	maxOutputTokens: number,
	modelReasoning: 'optional' | 'required',
	modelReasoningEfforts: string[],
	budgetMaximum?: number
): Pick<
	ProviderDeploymentContract,
	| 'authorId'
	| 'contextWindowTokens'
	| 'inputModalities'
	| 'maxOutputTokens'
	| 'modelReasoning'
	| 'modelReasoningEfforts'
	| 'modelReasoningMaxTokens'
	| 'outputModalities'
> {
	return {
		authorId: 'anthropic',
		contextWindowTokens,
		inputModalities: ['text', 'image'],
		maxOutputTokens,
		modelReasoning,
		modelReasoningEfforts,
		modelReasoningMaxTokens: budgetMaximum === undefined ? null : budget(budgetMaximum),
		outputModalities: ['text']
	};
}

/**
 * Token prices per million: input, cache read, 5-minute and 1-hour cache writes and output, and
 * the same five for prompts over 100,000 tokens where a model charges more for them.
 */
export function tokenPrices(
	input: string,
	cached: string,
	write5m: string,
	write1h: string,
	output: string,
	over100k?: [string, string, string, string, string]
) {
	const meters = [
		'input_tokens',
		'cached_input_tokens',
		'cache_write_5m_input_tokens',
		'cache_write_1h_input_tokens',
		'output_tokens'
	];
	return Object.fromEntries(
		[input, cached, write5m, write1h, output].map((price, index) => [
			meters[index]!,
			{
				per_mill_tokens: price,
				...(over100k ? { per_mill_context_gt_100k: over100k[index]! } : {})
			}
		])
	);
}
