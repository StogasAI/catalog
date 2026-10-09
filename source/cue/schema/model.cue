package catalog

#Model: close({
	authorId: #Id
	// Selects the gateway's local estimator; implementations and buffers are code-owned.
	name:     string & !=""
	aliases?: [...#Slug]
	groupIds?: [...#Id]
	retired?: true
	derivedFrom?: [...#Id]
	flavors?: [...#Flavor]
	// Maximum active sequence for one generation: provider-counted input plus output.
	contextWindowTokens: int & >0
	// Independent input ceiling; omitted when no narrower ceiling is documented.
	maxInputTokens?: int & >0
	// Maximum generated output inside contextWindowTokens; it does not extend the window.
	maxOutputTokens: int & >0
	inputModalities: [#Modality, ...#Modality]
	outputModalities: [#Modality, ...#Modality]
	capabilities?: close({
		streaming?:               bool
		functionCalling?:         bool
		parallelFunctionCalling?: bool
		implicitPromptCaching?:   bool
		explicitPromptCaching?:   bool
		structuredOutputs?:       bool
		systemMessages?:          bool
		toolChoice?:              bool
		urlContext?:              bool
	})
	reasoning:          #Reasoning
	reasoningEfforts:   [...#ReasoningEffort]
	reasoningMaxTokens: null | #ReasoningMaxTokens
	snapshot?:        #MaybeDate
	releaseDate?:     #MaybeDate
	knowledgeCutoff?: #MaybeDate
	deprecationDate?: #MaybeDate
})
