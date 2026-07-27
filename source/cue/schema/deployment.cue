package catalog

#DeploymentCapabilityOverrides: close({
	streaming?:       bool
	functionCalling?: bool
	promptCaching?:   bool
	systemMessages?:  bool
	toolChoice?:      bool
	webSearch?:       bool
})

#Deployment: close({
	modelId:    #Id
	routeIds:   [#Id, ...#Id]
	upstreamId: #UpstreamId
	modelSelection: close({
		mode: #ModelSelectionMode
		modelId?:         #Id
		observedModelId?: #Id
		observedAt?:      #Date
		candidateModelIds?: [...#Id]
	})
	if modelSelection.mode == "fixed" {
		modelSelection: modelId: modelId
	}
	aliases: [#Slug]: #Alias
	serviceTier?:       #ServiceTier
	speed?:             #Speed
	processingRegionId?: #Id
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

