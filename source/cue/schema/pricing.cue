package catalog

#FlatTokenRate: close({
	per_mill_tokens: #USD
})

#ContextTokenRate: close({
	per_mill_context_lte_272k: #USD
	per_mill_context_gt_272k:  #USD
})

#TokenRate: #FlatTokenRate | #ContextTokenRate

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

#ProviderPricing: close({
	anthropic_web_search_calls?: #CallRate
})

#RoutePricing: close({
	openai_responses_web_search_calls?:                       #CallRate
	openai_responses_web_search_preview_calls?:               #CallRate
	openai_responses_web_search_preview_non_reasoning_calls?: #CallRate
})

#InheritedPricingOverride: close({
	anthropic_web_search_calls?:                              #CallRate
	openai_responses_web_search_calls?:                       #CallRate
	openai_responses_web_search_preview_calls?:               #CallRate
	openai_responses_web_search_preview_non_reasoning_calls?: #CallRate
})

#DeploymentPricing: close({
	#TokenPricing
	openai_chat_completion_search_model_calls?:         #CallRate
	openai_chat_completion_search_preview_model_calls?: #SearchContextCallRate
})
