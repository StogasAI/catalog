package catalog

// File types the provider reads natively from a document part. Image and audio
// parts follow inputModalities.
#DocumentFormats: close({
	mediaTypes: [...string & =~"^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$"]
	extensions: [...string & =~"^\\.[a-z0-9][a-z0-9._+-]*$"]
})

#RouteCapabilities: close({
	streaming:               bool
	functionCalling:         bool
	parallelFunctionCalling: bool
	implicitPromptCaching:   bool
	explicitPromptCaching:   bool
	structuredOutputs:       bool
	systemMessages:          bool
	toolChoice:              bool
})

#CapabilityOverrides: close({
	streaming?:               bool
	functionCalling?:         bool
	parallelFunctionCalling?: bool
	implicitPromptCaching?:   bool
	explicitPromptCaching?:   bool
	structuredOutputs?:       bool
	systemMessages?:          bool
	toolChoice?:              bool
})

// A model or deployment can only take away what its routes offer.
#UnsupportedCapabilities: close({
	streaming?:               false
	functionCalling?:         false
	parallelFunctionCalling?: false
	implicitPromptCaching?:   false
	explicitPromptCaching?:   false
	structuredOutputs?:       false
	systemMessages?:          false
	toolChoice?:              false
})

#Route: close({
	providerId: #Id
	endpoint?:  string & =~"^https://"
	interfaces: [#Interface, ...#Interface]
	// The route is a provider's batch API, which runs a file of requests within
	// a window at its batch prices. Its deployments serve no other route and
	// name no service tier. The gateway has no batch API, so Stogas serves no
	// batch route.
	batch?: true
	if batch != _|_ {
		stogasSupported: false
	}

	// Content the route carries to the provider. A deployment accepts the
	// modalities that both its model and the route accept.
	inputModalities: [#Modality, ...#Modality]
	documentFormats: #DocumentFormats
	dataHandling:    #RouteDataHandling
	// Tools that run at the provider, or at a service that it calls, when a
	// request lists them. A deployment offers each tool whose hostings include
	// its own, and requests that list a tool route only to deployments that
	// offer it.
	hostedTools?: [#HostedTool, ...#HostedTool]
	overrides?: close({
		capabilities?: #CapabilityOverrides
	})
	// The date that the provider names for shutting this route down, such as an
	// API that it retires. Its deployments stop serving through it then, and a
	// deployment that no other route serves retires.
	retirementDate?: #Date
	// Stogas does not serve this route, so none of its deployments either, and its notes say why.
	stogasSupported?: false
	if stogasSupported != _|_ {
		notes: #Note
	}
	notes?: #Note
	periods?: [#Period, ...#Period]
})
