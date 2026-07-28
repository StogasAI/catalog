package catalog

#Model: close({
	authorId: #Id
	name:     string & !=""
	aliases:  [...#Slug]
	family:   string
	series:   string
	derivedFrom?: [...#Id]
	flavors: [...#Flavor]
	limits: close({
		contextTokens: int & >0
		outputTokens:  int & >0
	})
	capabilities: close({
		inputModalities:  [#Modality, ...#Modality]
		outputModalities: [#Modality, ...#Modality]
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
	reasoningEfforts: [...#ReasoningEffort]
	snapshot:        #MaybeDate
	releaseDate:     #MaybeDate
	knowledgeCutoff: #MaybeDate
	deprecationDate: #MaybeDate
})
