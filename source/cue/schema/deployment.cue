package catalog

// upstream holds what the gateway sends to the provider or binds a target by: the model, a tier,
// geography or mode that a request field selects, and the identifiers of a customer's target.
// Who runs the model is the deployment's hosting, not an upstream field.
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

// Chutes runs the models of its end-to-end encrypted route itself, in a TEE, and selects an
// instance by the GPU count that the encrypted transport attests. It forwards the models of its
// Standard route to inference platforms that it does not name. The build checks which hosting
// each route takes.
#ChutesDeployment: {
	hosting: "chutes"
	upstream: close({
		model:    #UpstreamId
		chuteId:  #Uuid
		gpuCount: int & >=1 & <=8
	})
	...
} | {
	hosting: "unknown"
	upstream: close({
		model:   #UpstreamId
		chuteId: #Uuid
	})
	...
}

#AzureModelFormat: "Anthropic" | "DeepSeek" | "Fireworks" | "OpenAI" | "OpenAI-OSS"

#AzureUpstream: close({
	model:          #UpstreamId
	modelFormat:    #AzureModelFormat
	modelVersion:   #UpstreamId
	deploymentType: "instant" | "global_standard" | "data_zone_standard_us" | "data_zone_standard_eu" | "data_zone_standard_apac"
	reasoningMode?: "pro"
	serviceTier?:   "flex" | "fast"
})

// AWS serves Claude two ways: Amazon Bedrock runs it on AWS (hosting aws),
// and Claude Platform on AWS is Anthropic's own service billed through AWS
// (hosting anthropic). inferenceGeo is the geography of Bedrock's inference
// profile, the prefix of its ID, or Anthropic's inference geography, which
// models before Claude 4.6 do not take; the build requires it for Bedrock.
#AWSDeployment: {
	hosting: "aws" | "anthropic"
	upstream: close({
		model:         #UpstreamId
		inferenceGeo?: #InferenceGeography
		if hosting == "anthropic" {
			inferenceGeo?: "global" | "us"
		}
	})
	...
}

// Every inference geography: Bedrock's inference profiles name global and
// those that keep inference in one country or union, which include each
// geography that Anthropic and Google Cloud name.
#InferenceGeography: "global" | "us" | "eu" | "jp" | "au" | "in" | "ca"

// Google Cloud serves Claude two ways: Google runs it on Agent Platform,
// formerly Vertex AI (hosting google-cloud), and Anthropic runs it itself, billed
// through Google Cloud (hosting anthropic). inferenceGeo is Google's endpoint
// location, global or the us or eu multi-region, or Anthropic's inference
// geography, which has no eu and which models before Claude 4.6 do not take;
// the build requires it for Agent Platform. fast is Anthropic's Fast mode,
// which only Anthropic's hosting offers.
#GoogleCloudDeployment: {
	hosting: "google-cloud" | "anthropic"
	upstream: close({
		model:         #UpstreamId
		inferenceGeo?: "global" | "us" | "eu"
		if hosting == "anthropic" {
			inferenceGeo?: "global" | "us"
		}
		serviceTier?: "fast"
	})
	if upstream.serviceTier != _|_ {
		hosting: "anthropic"
	}
	...
}

// A company that handles requests: a provider's ID, the ID of a company that the catalog lists
// no provider for, or unknown for one that the provider does not name.
#Company: "anthropic" | "aws" | "azure" | "chutes" | "fireworks" | "google-cloud" | "openai" | "unknown"

#Upstream: close({
	model:           #UpstreamId
	chuteId?:        #Uuid
	gpuCount?:       int & >=1 & <=8
	serviceTier?:    "flex" | "fast" | "ultrafast"
	inferenceGeo?:   #InferenceGeography
	reasoningMode?:  "pro"
	modelFormat?:    #AzureModelFormat
	modelVersion?:   #UpstreamId
	deploymentType?: "instant" | "global_standard" | "data_zone_standard_us" | "data_zone_standard_eu" | "data_zone_standard_apac"
})

#Deployment: close({
	modelId: #Id
	routeIds: [#Id, ...#Id]
	// Who runs the model: the provider's own ID when it runs the model itself, the ID of the
	// company whose service it resells, or unknown when it forwards requests to a company that it
	// does not name. The deployment ID names any hosting other than the provider.
	hosting: #Company
	// The companies that a request passes through between the provider and the hosting, in the
	// order in which it reaches them, when the provider documents them. A provider that runs the
	// model itself has none. unknown stands for one or more that the provider does not name, and
	// a hosting of unknown already covers them. The deployment ID names each.
	via?: [#Company, ...#Company]
	upstream: #Upstream
	// The provider serves this deployment only to accounts it has approved.
	approvalRequired?: true
	// Omitted when the provider does not state it; the compiler writes unknown.
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
	notes?:             #Note
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
