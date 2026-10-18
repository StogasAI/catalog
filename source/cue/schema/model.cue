package catalog

#Model: close({
	authorId: #Id
	name:     string & !=""
	aliases?: [...#Slug]
	groupIds?: [...#Id]
	derivedFrom?: [...#Id]
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
	// Present only when the model owner exposes an immutable checkpoint ID.
	snapshot?:    #Date
	releaseDate:  #Date
	// Omitted when the model owner has not disclosed it.
	knowledgeCutoff?: #Date
	periods?: [#Period, ...#Period]
})
