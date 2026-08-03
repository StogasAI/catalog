package catalog

#Model: close({
	authorId: #Id
	name:     string & !=""
	aliases?: [...#Slug]
	family: string
	series: string
	derivedFrom?: [...#Id]
	flavors?: [...#Flavor]
	// Maximum active sequence for one generation: provider-counted input plus output.
	contextWindowTokens: int & >0
	// Maximum generated output inside contextWindowTokens; it does not extend the window.
	maxOutputTokens: int & >0
	inputModalities: [#Modality, ...#Modality]
	outputModalities: [#Modality, ...#Modality]
	capabilities?: close({
		streaming?:               bool
		cancellation?:            bool
		functionCalling?:         bool
		parallelFunctionCalling?: bool
		promptCaching?:           bool
		structuredOutputs?:       bool
		systemMessages?:          bool
		toolChoice?:              bool
		webSearch?:               bool
		urlContext?:              bool
		pdfInput?:                bool
	})
	reasoningEfforts?: [...#ReasoningEffort]
	snapshot?:        #MaybeDate
	releaseDate?:     #MaybeDate
	knowledgeCutoff?: #MaybeDate
	deprecationDate?: #MaybeDate
})
