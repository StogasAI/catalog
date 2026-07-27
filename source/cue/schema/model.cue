package catalog

#Model: close({
	authorId:   #Id
	name:       string & !=""
	family:     string
	series:     string
	snapshot:   #MaybeDate
	derivedFrom: [...#Id]
	flavors:    [...#Flavor]
	limits: close({
		contextTokens: int & >0
		outputTokens:  int & >0
	})
	capabilities: close({
		inputModalities:  [#Modality, ...#Modality]
		outputModalities: [#Modality, ...#Modality]
	})
	reasoningEfforts: [...#ReasoningEffort]
	releaseDate:     #MaybeDate
	knowledgeCutoff: #MaybeDate
})
