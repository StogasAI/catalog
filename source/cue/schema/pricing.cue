package catalog

// A per_mill_context_gt_<N>k rate replaces per_mill_tokens for every token of
// its meter, output included, when the request's prompt, counting cached and
// cache write tokens, has more than N thousand tokens. The largest cutoff below
// the prompt applies.
#TokenRate: close({
	per_mill_tokens: #USD
	[=~"^per_mill_context_gt_[1-9][0-9]*k$"]: #USD
})

#CallRate: close({
	per_1k_calls: #USD
})

#SearchContextCallRate: close({
	per_1k_search_context_low_calls:    #USD
	per_1k_search_context_medium_calls: #USD
	per_1k_search_context_high_calls:   #USD
})

#TokenPricing: {
	input_tokens?:                #TokenRate
	cached_input_tokens?:         #TokenRate
	cache_write_input_tokens?:    #TokenRate
	cache_write_5m_input_tokens?: #TokenRate
	cache_write_1h_input_tokens?: #TokenRate
	output_tokens?:               #TokenRate
	reasoning_tokens?:            #TokenRate
}

#RoutePricing: close({
	anthropic_web_search_calls?:                              #CallRate
	openai_responses_web_search_calls?:                       #CallRate
	openai_responses_web_search_preview_calls?:               #CallRate
	openai_responses_web_search_preview_non_reasoning_calls?: #CallRate
})

// A deployment prices web search itself when its route serves hostings that
// differ, as Claude on AWS and Google Cloud does: only Anthropic's hosting runs it.
#DeploymentPricing: close({
	#TokenPricing
	anthropic_web_search_calls?:                        #CallRate
	openai_chat_completion_search_model_calls?:         #CallRate
	openai_chat_completion_search_preview_model_calls?: #SearchContextCallRate
})
