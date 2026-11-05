package catalog

// serviceTier names a provider-neutral tier; the compiler records an omitted tier as standard.
// batch is a provider's batch API, which runs a file of requests within a window at its batch
// prices on routes of its own.
#OpenAIUpstream: close({
	model:          #UpstreamId
	reasoningMode?: "pro"
	serviceTier?:   "flex" | "fast" | "ultrafast" | "batch"
})

#AnthropicUpstream: close({
	model:         #UpstreamId
	serviceTier?:  "fast" | "batch"
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
// (hosting anthropic). inferenceGeo is the geography of Bedrock's inference
// profile, the prefix of its ID, or Anthropic's inference geography. batch is
// Bedrock's batch inference, which runs a file of requests from Amazon S3 on
// a route of its own.
#AWSUpstream: close({
	model:   #UpstreamId
	hosting: "aws" | "anthropic"
	inferenceGeo: #InferenceGeography
	if hosting == "anthropic" {
		inferenceGeo: "global" | "us"
	}
	serviceTier?: "batch"
	if serviceTier != _|_ {
		hosting: "aws"
	}
})

// Every inference geography: Bedrock's inference profiles name global and
// those that keep inference in one country or union, which include each
// geography that Anthropic and Google Cloud name.
#InferenceGeography: "global" | "us" | "eu" | "jp" | "au" | "in" | "ca"

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

// Who runs the model when a provider resells another operator's service.
#Hosting: "azure" | "anthropic" | "fireworks" | "aws" | "google"

#Upstream: close({
	model:           #UpstreamId
	chuteId?:        #Uuid
	gpuCount?:       int & >=1 & <=8
	serviceTier?:    "flex" | "fast" | "ultrafast" | "batch"
	inferenceGeo?:   #InferenceGeography
	reasoningMode?:  "pro"
	hosting?:        #Hosting
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
	// Stogas does not serve this deployment. A deployment that Stogas serves on one route serves
	// on all of them, so a deployment on a route that Stogas does not serve is not served either.
	stogasUnsupported?: #UnsupportedReason
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
