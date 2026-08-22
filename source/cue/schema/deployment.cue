package catalog

#OpenAIUpstream: close({
	model:          #UpstreamId
	reasoningMode?: "pro"
	serviceTier:    "default" | "flex" | "priority"
})

#AnthropicUpstream: close({
	model:         #UpstreamId
	speed?:        "standard" | "fast"
	inferenceGeo?: "global" | "us"
})

#ChutesUpstream: close({
	model:    #UpstreamId
	chuteId:  #Uuid
	gpuCount: int & >=1 & <=8
})

#AzureUpstream: close({
	model:          #UpstreamId
	modelFormat:    #UpstreamId
	modelVersion:   #UpstreamId
	hosting:        "azure" | "anthropic" | "fireworks" | "nvidia"
	deploymentType: "instant" | "global_standard" | "data_zone_standard_us" | "data_zone_standard_eu" | "data_zone_standard_apac"
	reasoningMode?: "pro"
	serviceTier?:   "default" | "priority"
})

#Upstream: close({
	model:           #UpstreamId
	chuteId?:        #Uuid
	gpuCount?:       int & >=1 & <=8
	serviceTier?:    "default" | "flex" | "priority" | "standard_only"
	speed?:          "standard" | "fast"
	inferenceGeo?:   "global" | "us"
	reasoningMode?:  "pro"
	hosting?:        "azure" | "anthropic" | "fireworks" | "nvidia"
	modelFormat?:    #UpstreamId
	modelVersion?:   #UpstreamId
	deploymentType?: "instant" | "global_standard" | "data_zone_standard_us" | "data_zone_standard_eu" | "data_zone_standard_apac"
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
	urlContext?:              bool
	pdfInput?:                bool
})

#DeploymentRouteOverride: close({
	reasoningEfforts: [...#ReasoningEffort]
})

#Deployment: close({
	modelId: #Id
	routeIds: [#Id, ...#Id]
	upstream: #Upstream
	aliases?: [...#Slug]
	weightPrecision?: #WeightPrecision
	overrides?: close({
		contextWindowTokens?: int & >0
		maxOutputTokens?:     int & >0
		inputModalities?: [#Modality, ...#Modality]
		outputModalities?: [#Modality, ...#Modality]
		capabilities?:          #DeploymentCapabilityOverrides
		reasoningAvailability?: #ReasoningAvailability
		reasoningEfforts?: [...#ReasoningEffort]
		reasoningMaxTokens?: null | #ReasoningMaxTokens
		routes?: close({[#Id]: #DeploymentRouteOverride})
		dataHandling?:    #DeploymentDataHandlingOverride
		moderated?:       bool
		pricing?:         #InheritedPricingOverride
		deprecationDate?: #MaybeDate
	})
	pricing: #DeploymentPricing
})
