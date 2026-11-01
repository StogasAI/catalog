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

// AWS serves Claude two ways: Amazon Bedrock runs it on AWS (hosting aws),
// and Claude Platform on AWS is Anthropic's own service billed through AWS
// (hosting anthropic). inferenceGeo is Bedrock's endpoint type or
// Anthropic's inference geography.
#AWSUpstream: close({
	model:        #UpstreamId
	hosting:      "aws" | "anthropic"
	inferenceGeo: "global" | "us"
})

// Google Cloud serves Claude two ways: Google runs it on Agent Platform,
// formerly Vertex AI (hosting google), and Anthropic runs it itself, billed
// through Google Cloud (hosting anthropic). inferenceGeo is Google's endpoint
// location, global or the us or eu multi-region, or Anthropic's inference
// geography, which has no eu.
#GoogleCloudUpstream: close({
	model:   #UpstreamId
	hosting: "google" | "anthropic"
	inferenceGeo: "global" | "us" | "eu"
	if hosting == "anthropic" {
		inferenceGeo: "global" | "us"
	}
})

#Upstream: close({
	model:           #UpstreamId
	chuteId?:        #Uuid
	gpuCount?:       int & >=1 & <=8
	serviceTier?:    "flex" | "fast" | "ultrafast"
	inferenceGeo?:   "global" | "us" | "eu"
	reasoningMode?:  "pro"
	hosting?:        "azure" | "anthropic" | "fireworks" | "aws" | "google"
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
	// The date that the provider names for the deployment's shutdown or
	// retirement, as it names it. Readers keep routing to the deployment until
	// that date has ended everywhere on Earth, at 12:00 UTC on the next day, so
	// it never retires before its provider stops it; omitted when no date is
	// announced.
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
