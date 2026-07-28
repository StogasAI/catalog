package catalog

#OpenAIUpstream: close({
	model: #UpstreamId
	fixedRequest: close({
		service_tier: "default" | "flex" | "priority"
	})
})

#AnthropicUpstream: close({
	model: #UpstreamId
	fixedRequest: close({
		speed?:         "standard" | "fast"
		inference_geo?: "global" | "us"
		service_tier:  "standard_only"
	})
})

#Upstream: #OpenAIUpstream | #AnthropicUpstream

#Deployment: close({
	modelId:  #Id
	routeIds: [#Id, ...#Id]
	upstream: #Upstream
	default: bool
	aliases: [...#Slug]
	limits?: close({
		contextTokens?: int & >0
		outputTokens?:  int & >0
	})
	capabilities?: #RouteCapabilityOverrides
	reasoningEfforts?: [...#ReasoningEffort]
	dataHandling?: #DataHandlingOverride
	moderated?:    bool
	weightPrecision?: #WeightPrecision
	tee?: close({
		status:                #TeeStatus
		mechanism:             #TeeMechanism
		evidenceUri?:          string & !=""
		attestationStatusUri?: string & !=""
	})
	pricing: #Pricing
	deprecationDate: #MaybeDate
})
