package catalog

#DeploymentCapabilityOverrides: close({
	streaming?:       bool
	functionCalling?: bool
	promptCaching?:   bool
	systemMessages?:  bool
	toolChoice?:      bool
	webSearch?:       bool
})

#OpenAIUpstream: close({
	model: #UpstreamId
	fixedRequest: close({
		service_tier: "default" | "flex" | "priority"
	})
})

#AnthropicUpstream: close({
	model: #UpstreamId
	fixedRequest: close({
		speed:         "standard" | "fast"
		inference_geo: "global" | "us"
		service_tier:  "standard_only"
	})
})

#Upstream: #OpenAIUpstream | #AnthropicUpstream

#Deployment: close({
	modelId:  #Id
	routeIds: [#Id, ...#Id]
	upstream: #Upstream
	aliases: [#Slug, ...#Slug]
	limits?: close({
		contextTokens?: int & >0
		outputTokens?:  int & >0
	})
	capabilities?: #DeploymentCapabilityOverrides
	reasoningEfforts?: [...#ReasoningEffort]
	dataHandling?: #DataHandlingOverride
	moderation?:   #ModerationOverride
	tee?: close({
		status:    #TeeStatus
		mechanism: #TeeMechanism
	})
	pricing: #Pricing
	status:        #LifecycleStatus
	deprecatedAt?: #Date
	retiredAt?:    #Date
})
