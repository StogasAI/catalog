package catalog

#OpenAIUpstream: close({
	model:       #UpstreamId
	reasoningMode?: "pro"
	serviceTier: "default" | "flex" | "priority"
})

#AnthropicUpstream: close({
	model:        #UpstreamId
	serviceTier:  "standard_only"
	speed?:       "standard" | "fast"
	inferenceGeo?: "global" | "us"
})

#ChutesUpstream: close({
	model:    #UpstreamId
	chuteId:  #Uuid
	gpuCount: int & >=1 & <=8
})

#AzureUpstream: close({
	model: #UpstreamId
})

#Upstream: close({
	model:         #UpstreamId
	chuteId?:      #Uuid
	gpuCount?:     int & >=1 & <=8
	serviceTier?:  "default" | "flex" | "priority" | "standard_only"
	speed?:        "standard" | "fast"
	inferenceGeo?: "global" | "us"
	reasoningMode?: "pro"
})

#DeploymentCapabilityOverrides: close({
	streaming?:               bool
	cancellation?:            bool
	functionCalling?:         bool
	parallelFunctionCalling?: bool
	implicitPromptCaching?:   bool
	explicitPromptCaching?:   bool
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
	aliases?: [...#Slug]
	weightPrecision?: #WeightPrecision
	tee?: #Tee
	overrides?: close({
		contextWindowTokens?: int & >0
		maxOutputTokens?:     int & >0
		inputModalities?: [#Modality, ...#Modality]
		outputModalities?: [#Modality, ...#Modality]
		capabilities?: #DeploymentCapabilityOverrides
		reasoningAvailability?: #ReasoningAvailability
		reasoningEfforts?:      [...#ReasoningEffort]
		reasoningMaxTokens?:    null | #ReasoningMaxTokens
		dataHandling?:          #DataHandlingOverride
		moderated?:             bool
		deprecationDate?:       #MaybeDate
	})
	pricing: #DeploymentPricing
})
