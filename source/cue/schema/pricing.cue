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

// cache_write_input_tokens is a cache write at the deployment's default lifetime,
// which is 30 minutes in OpenAI's format. Claude prices its writes by lifetime,
// and OpenAI's format prices its 12-hour writes apart.
#TokenPricing: {
	input_tokens?:                 #TokenRate
	cached_input_tokens?:          #TokenRate
	cache_write_input_tokens?:     #TokenRate
	cache_write_5m_input_tokens?:  #TokenRate
	cache_write_1h_input_tokens?:  #TokenRate
	cache_write_12h_input_tokens?: #TokenRate
	output_tokens?:                #TokenRate
	reasoning_tokens?:             #TokenRate
}

// The call meters of a hosted tool. Content that a tool adds to the context,
// such as search results or a fetched page, bills as input tokens.
#HostedToolPricing: close({
	anthropic_web_search_calls?:                              #CallRate
	openai_responses_web_search_calls?:                       #CallRate
	openai_responses_web_search_preview_calls?:               #CallRate
	openai_responses_web_search_preview_non_reasoning_calls?: #CallRate
})

// Search models charge for the search that every request makes, so their
// call meters belong to the deployment.
#DeploymentPricing: close({
	#TokenPricing
	openai_chat_completion_search_model_calls?:         #CallRate
	openai_chat_completion_search_preview_model_calls?: #SearchContextCallRate
})
