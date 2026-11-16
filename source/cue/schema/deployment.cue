package catalog

// upstream holds what the gateway sends to the provider or binds a target by: the model, a tier,
// geography or mode that a request field selects, and the identifiers of a customer's target.
// Who runs the model is the deployment's hosting, not an upstream field.
// serviceTier names a provider-neutral tier; the compiler records an omitted tier as standard.
// inferenceGeo is the region of an OpenAI data residency endpoint that both stores and runs
// requests there, the prefix of its host.
#OpenAIUpstream: close({
	model:          #UpstreamId
	reasoningMode?: "pro"
	serviceTier?:   "flex" | "fast" | "ultrafast"
	inferenceGeo?:  "us" | "eu" | "au" | "jp" | "in" | "ae"
})

#AnthropicUpstream: close({
	model:         #UpstreamId
	serviceTier?:  "fast"
	inferenceGeo?: "global" | "us"
})

// Chutes selects an instance of its end-to-end encrypted route by the GPU count that the encrypted
// transport attests. The build requires the count on that route and refuses it on the others.
#ChutesUpstream: close({
	model:     #UpstreamId
	chuteId:   #Uuid
	gpuCount?: int & >=1 & <=8
})

#AzureModelFormat: "Anthropic" | "DeepSeek" | "Fireworks" | "OpenAI" | "OpenAI-OSS"

// The type of Azure deployment that a customer creates. Data Zone types keep processing and
// storage in their zone, and the batch types serve only the batch routes.
#AzureDeploymentType: "instant" | "global_standard" | "data_zone_standard_us" | "data_zone_standard_eu" | "data_zone_standard_apac" | "global_batch" | "data_zone_batch_us"

#AzureUpstream: close({
	model:          #UpstreamId
	modelFormat:    #AzureModelFormat
	modelVersion:   #UpstreamId
	deploymentType: #AzureDeploymentType
	reasoningMode?: "pro"
	serviceTier?:   "flex" | "fast"
})

// inferenceGeo is the geography of Bedrock's inference profile, the prefix of its ID, or
// Anthropic's inference geography on Claude Platform on AWS, which models before Claude 4.6 do
// not take. The build requires it for Bedrock and checks the geographies that Anthropic takes.
#AWSUpstream: close({
	model:         #UpstreamId
	inferenceGeo?: #InferenceGeography
})

// Every inference geography: Bedrock's inference profiles name global and
// those that keep inference in one country or union, which include each
// geography that Anthropic and Google Cloud name, and OpenAI's data residency
// regions add ae.
#InferenceGeography: "global" | "us" | "eu" | "jp" | "au" | "in" | "ca" | "ae"

// inferenceGeo is Google's endpoint location on Agent Platform, global or the us or eu
// multi-region, or Anthropic's inference geography where Anthropic runs Claude, which has no eu
// and which models before Claude 4.6 do not take. The build requires it for Agent Platform and
// checks the geographies that Anthropic takes. fast is Anthropic's Fast mode, which the build
// allows only where Anthropic runs the model.
#GoogleCloudUpstream: close({
	model:         #UpstreamId
	inferenceGeo?: "global" | "us" | "eu"
	serviceTier?:  "fast"
})

#Upstream: close({
	model:           #UpstreamId
	chuteId?:        #Uuid
	gpuCount?:       int & >=1 & <=8
	serviceTier?:    "flex" | "fast" | "ultrafast"
	inferenceGeo?:   #InferenceGeography
	reasoningMode?:  "pro"
	modelFormat?:    #AzureModelFormat
	modelVersion?:   #UpstreamId
	deploymentType?: #AzureDeploymentType
})

#Deployment: close({
	modelId: #Id
	routeIds: [#Id, ...#Id]
	// Who runs the model, when it is not the company that the deployment's routes name or, where
	// they name none, the provider's company: the company whose service the provider resells, or
	// unknown when it forwards requests to a company that it does not name. The deployment ID
	// names any hosting other than the provider's company.
	hosting?: #CompanyRef
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
	// Stogas does not serve this deployment. A deployment that Stogas serves on one route serves on
	// all of them, so a deployment on a route that Stogas does not serve is not served either.
	stogasSupported?: false
	notes?:           #Note
	// Narrower facts than the deployment inherits from its model and routes.
	overrides?: close({
		contextWindowTokens?: int & >0
		maxOutputTokens?:     int & >0
		capabilities?:        #UnsupportedCapabilities
		reasoningEfforts?: [...#ReasoningEffort]
		reasoningMaxTokens?: null | #ReasoningMaxTokens
		// What this provider's deployment does without a reasoning control, or null when it is
		// not stated, where that differs from the model's.
		reasoningDefault?: null | #ReasoningDefault
		sampling?:         #UnsupportedSampling
		// The provider's own minimum for this deployment, or null when it states none.
		promptCacheMinimumTokens?: null | (int & >0)
		inputLimits?:              #InputLimits
		dataHandling?:             #DeploymentDataHandlingOverride
	})
	pricing: #DeploymentPricing
	periods?: [#Period, ...#Period]
})
