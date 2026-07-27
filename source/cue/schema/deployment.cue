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
	aliases: [#Slug]: #Alias
	limits?: close({
		contextTokens?: int & >0
		outputTokens?:  int & >0
	})
	capabilities?: #DeploymentCapabilityOverrides
	reasoning?: close({
		acceptedEfforts: [...#ReasoningEffort]
		maxTokens?: close({
			min: int & >0
			max: int & >0
		})
	})
	dataHandling?: #DataHandlingOverride
	moderation?:   #ModerationOverride
	tee?: close({
		status:      #TeeStatus
		mechanism:   #TeeMechanism
		evidenceIds: [#Id, ...#Id]
	})
	pricing: #Pricing
	lifecycle: close({
		status:        #LifecycleStatus
		deprecatedAt?: #Date
		retiredAt?:    #Date
	})
})
