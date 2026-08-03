package catalog

#OpenAIUpstream: close({
	model:       #UpstreamId
	serviceTier: "default" | "flex" | "priority"
})

#AnthropicUpstream: close({
	model:        #UpstreamId
	serviceTier:  "standard_only"
	speed?:       "standard" | "fast"
	inferenceGeo?: "global" | "us"
})

#ChutesUpstream: close({
	model:   #UpstreamId
	chuteId: #Uuid
})

#ChutesRelease: close({
	chuteVersion:   #Uuid
	modelRevision:  #GitRevision
	imageId:        #Uuid
	imageName:      string & !=""
	imageTag:       string & !=""
	runtimeVersion: string & !=""
})

#Upstream: close({
	model:         #UpstreamId
	chuteId?:      #Uuid
	serviceTier?:  "default" | "flex" | "priority" | "standard_only"
	speed?:        "standard" | "fast"
	inferenceGeo?: "global" | "us"
})

#DeploymentCapabilityOverrides: close({
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

#Deployment: close({
	modelId: #Id
	routeIds: [#Id, ...#Id]
	upstream: #Upstream
	release?: #ChutesRelease
	aliases?: [...#Slug]
	weightPrecision?: #WeightPrecision
	overrides?: close({
		contextWindowTokens?: int & >0
		maxOutputTokens?:     int & >0
		inputModalities?: [#Modality, ...#Modality]
		outputModalities?: [#Modality, ...#Modality]
		capabilities?: #DeploymentCapabilityOverrides
		reasoningEfforts?: [...#ReasoningEffort]
		dataHandling?:    #DataHandlingOverride
		moderated?:       bool
		tee?:             #TeeOverride
		deprecationDate?: #MaybeDate
	})
	pricing: #Pricing
})
