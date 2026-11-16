package catalog

#Model: close({
	authorId: #Id
	name:     string & !=""
	aliases?: [...#Slug]
	groupIds?: [...#Id]
	// Maximum active sequence for one generation: provider-counted input plus output.
	contextWindowTokens: int & >0
	// Independent input ceiling; omitted when no narrower ceiling is documented.
	maxInputTokens?: int & >0
	// Maximum generated output inside contextWindowTokens; it does not extend the window.
	maxOutputTokens: int & >0
	inputModalities: [#Modality, ...#Modality]
	outputModalities: [#Modality, ...#Modality]
	// Features the model lacks on every route.
	capabilities?: #UnsupportedCapabilities
	reasoning:     #Reasoning
	// Omitted when the model has no effort levels.
	reasoningEfforts?: [#ReasoningEffort, ...#ReasoningEffort]
	// The model's shorter effort list on one provider API, such as GPT on Chat
	// Completions, which lacks max. It applies on routes that serve only that
	// interface, because they send requests to the provider unchanged.
	reasoningEffortsByInterface?: close({[#Interface]: [#ReasoningEffort, ...#ReasoningEffort]})
	// Omitted when the model accepts no reasoning token budget.
	reasoningMaxTokens?: #ReasoningMaxTokens
	// Omitted when the author does not state what the model does without a reasoning control.
	reasoningDefault?: #ReasoningDefault
	// The author publishes the model's weights for download.
	openWeights: bool
	// Sampling parameters that the model refuses on every route.
	sampling?: #UnsupportedSampling
	// The shortest prompt, in tokens, that providers cache for this model. Omitted when the author
	// states none or the model has no prompt caching. A deployment can state its provider's own.
	promptCacheMinimumTokens?: int & >0
	// Limits of the model that are narrower than those of its routes.
	inputLimits?: #InputLimits
	// The date of the immutable checkpoint that the model's ID pins, which the owner states or
	// writes into a dated ID whose date it documents as the snapshot's. Omitted otherwise.
	snapshot?:    #Date
	releaseDate:  #Date
	// Omitted when the model owner has not disclosed it. When the owner states several, the one for
	// the data that gives the model its general knowledge, such as the pretraining cutoff.
	knowledgeCutoff?: #Date
	notes?: #Note
	periods?: [#Period, ...#Period]
})
