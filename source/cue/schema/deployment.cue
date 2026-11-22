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

#AzureModelFormat: "Anthropic" | "DeepSeek" | "Fireworks" | "Mistral AI" | "MoonshotAI" | "OpenAI" | "OpenAI-OSS" | "xAI"

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
// us-gov is the profile of the AWS GovCloud (US) Regions, a separate AWS partition.
// regions lists the Regions of a Bedrock model that runs only in the Region of each request and
// so has no inference profile: the model ID names none, and each Region lies in the geography and
// charges the deployment's prices.
#AWSUpstream: close({
	model:         #UpstreamId
	inferenceGeo?: #InferenceGeography
	regions?: [#AWSRegion, ...#AWSRegion]
})

#AWSRegion: =~"^[a-z]{2}-[a-z]+-[1-9]$"

// Every inference geography: Bedrock's inference profiles name global, those that keep
// inference in one country or union, which include each geography that Anthropic and Google
// Cloud name, and us-gov. OpenAI's data residency regions add ae.
#InferenceGeography: "global" | "us" | "us-gov" | "eu" | "jp" | "au" | "in" | "ca" | "ae"

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
	regions?: [#AWSRegion, ...#AWSRegion]
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
	// Azure lists the deployment's model as a preview, whose terms decide its data handling.
	preview?: true
	// Omitted when the provider does not state it; the compiler writes unknown.
	weightPrecision?: #WeightPrecision
	// The date that the provider names for the deployment's shutdown or
	// retirement, as it names it. Readers keep routing to the deployment until
	// that date has ended everywhere on Earth, at 12:00 UTC on the next day, so
	// it never retires before its provider stops it; omitted when no date is
	// announced.
	retirementDate?: #Date
	// Stogas does not serve this deployment with a customer's own credential or with its own
	// account, although its routes do. Its routes agree on both, so it serves on all of them in
	// the same ways.
	stogasByok?:    false
	stogasManaged?: false
	notes?:         #Note
	// Narrower facts than the deployment inherits from its model and routes, on all of its routes.
	// Any fact that a provider's offer of a model can change has one: limits, modalities, document
	// formats, capabilities, sampling, efforts and hosted tools only narrow, and the provider's own
	// values replace the model's. What the model is, such as its release date, and what a route's
	// API is, such as its interfaces, have none: a different checkpoint is another model, and a
	// different API is another route.
	overrides?: close({
		contextWindowTokens?: int & >0
		maxInputTokens?:      int & >0
		maxOutputTokens?:     int & >0
		inputModalities?: [#Modality, ...#Modality]
		outputModalities?: [#Modality, ...#Modality]
		// The document formats of its routes that the provider reads for this deployment's model,
		// where it reads fewer, and empty lists where it reads none: Bedrock leaves every document
		// out of the prompt of a model that runs in the Region of each request.
		documentFormats?: close({
			mediaTypes: [...#MediaType]
			extensions: [...#Extension]
		})
		capabilities?: #UnsupportedCapabilities
		// Whether the deployment always reasons, never reasons or lets the request choose, where
		// its provider differs from the model's author. No provider gives reasoning to a model that
		// has none.
		reasoning?: #Reasoning
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
		// Hosted tools of its routes that the provider does not run for this deployment's model.
		hostedTools?: close({[#HostedToolId]: false})
		// Account options of its provider that do not reach this deployment although they cover
		// its routes.
		accountOptions?: close({[#Id]: false})
	})
	pricing: #DeploymentPricing
	periods?: [#Period, ...#Period]
})
