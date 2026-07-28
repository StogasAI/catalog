package catalog

#RouteCapabilities: close({
	streaming:               bool
	cancellation:            bool
	functionCalling:         bool
	parallelFunctionCalling: bool
	promptCaching:           bool
	structuredOutputs:       bool
	systemMessages:          bool
	toolChoice:              bool
	webSearch:               bool
	urlContext:              bool
	pdfInput:                bool
})

#RouteCapabilityOverrides: close({
	streaming?:               bool
	cancellation?:            bool
	functionCalling?:         bool
	parallelFunctionCalling?: bool
	promptCaching?:           bool
	structuredOutputs?:       bool
	systemMessages?:          bool
	toolChoice?:              bool
	webSearch?:               bool
	urlContext?:              bool
	pdfInput?:                bool
})

#Route: close({
	providerId:    #Id
	endpoint:      string & =~"^https://"
	interfaces:    [#Interface, ...#Interface]
	capabilities?: #RouteCapabilityOverrides
	dataHandling?: #DataHandlingOverride
	moderation?:   #ModerationOverride
	pricing?:      #Pricing
})
