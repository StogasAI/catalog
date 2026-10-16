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
	capabilities?: #CapabilityOverrides
	reasoning:     #Reasoning
	// Omitted when the model has no effort levels.
	reasoningEfforts?: [#ReasoningEffort, ...#ReasoningEffort]
	// A shorter effort list on routes that serve one interface, such as a
	// Chat Completions API that lacks max.
	reasoningEffortsByInterface?: close({[#Interface]: [#ReasoningEffort, ...#ReasoningEffort]})
	// Omitted when the model accepts no reasoning token budget.
	reasoningMaxTokens?: #ReasoningMaxTokens
	// Present only when the model owner exposes an immutable checkpoint ID.
	snapshot?:    #Date
	releaseDate:  #Date
	// Omitted when the model owner has not disclosed it.
	knowledgeCutoff?: #Date
	// Omitted when no shutdown date is announced.
	deprecationDate?: #Date
	periods?: [#Period, ...#Period]
})
