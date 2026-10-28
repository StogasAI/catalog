package catalog

// serviceTier names a provider-neutral tier; the compiler records an omitted tier as standard.
#OpenAIUpstream: close({
	model:          #UpstreamId
	reasoningMode?: "pro"
	serviceTier?:   "flex" | "fast" | "ultrafast"
})

#AnthropicUpstream: close({
	model:         #UpstreamId
	serviceTier?:  "fast"
	inferenceGeo?: "global" | "us"
})

#ChutesUpstream: close({
	model:    #UpstreamId
	chuteId:  #Uuid
	gpuCount: int & >=1 & <=8
})

#AzureModelFormat: "Anthropic" | "DeepSeek" | "Fireworks" | "OpenAI" | "OpenAI-OSS"

#AzureUpstream: close({
	model:          #UpstreamId
	modelFormat:    #AzureModelFormat
	modelVersion:   #UpstreamId
	hosting:        "azure" | "anthropic" | "fireworks"
	deploymentType: "instant" | "global_standard" | "data_zone_standard_us" | "data_zone_standard_eu" | "data_zone_standard_apac"
	reasoningMode?: "pro"
	serviceTier?:   "flex" | "fast"
})

#Upstream: close({
	model:           #UpstreamId
	chuteId?:        #Uuid
	gpuCount?:       int & >=1 & <=8
	serviceTier?:    "flex" | "fast" | "ultrafast"
	inferenceGeo?:   "global" | "us"
	reasoningMode?:  "pro"
	hosting?:        "azure" | "anthropic" | "fireworks"
	modelFormat?:    #AzureModelFormat
	modelVersion?:   #UpstreamId
	deploymentType?: "instant" | "global_standard" | "data_zone_standard_us" | "data_zone_standard_eu" | "data_zone_standard_apac"
})

#Deployment: close({
	modelId: #Id
	routeIds: [#Id, ...#Id]
	upstream: #Upstream
	// The provider serves this deployment only to accounts it has approved.
	approvalRequired?: true
	weightPrecision?: #WeightPrecision
	// The UTC date of the earliest moment at which the provider may stop serving
	// the deployment, which is retired from 00:00 UTC that day; omitted when no
	// date is announced.
	retirementDate?: #Date
	// Narrower facts than the deployment inherits from its model and routes.
	overrides?: close({
		contextWindowTokens?: int & >0
		maxOutputTokens?:     int & >0
		capabilities?:        #UnsupportedCapabilities
		reasoningEfforts?: [...#ReasoningEffort]
		reasoningMaxTokens?: null | #ReasoningMaxTokens
		dataHandling?:       #DeploymentDataHandlingOverride
	})
	pricing: #DeploymentPricing
	periods?: [#Period, ...#Period]
})
