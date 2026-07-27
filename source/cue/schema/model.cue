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
	reasoning: close({
		acceptedEfforts: [...#ReasoningEffort]
		maxTokens?: close({
			min: int & >0
			max: int & >0
		})
	})
	releaseDate:     #MaybeDate
	knowledgeCutoff: #MaybeDate
})

