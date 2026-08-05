package catalog

#RouteCapabilities: close({
	streaming:               bool
	cancellation:            bool
	functionCalling:         bool
	parallelFunctionCalling: bool
	implicitPromptCaching:   bool
	explicitPromptCaching:   bool
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
	implicitPromptCaching?:   bool
	explicitPromptCaching?:   bool
	structuredOutputs?:       bool
	systemMessages?:          bool
	toolChoice?:              bool
	webSearch?:               bool
	urlContext?:              bool
	pdfInput?:                bool
})

#Route: close({
	providerId: #Id
	endpoint?:  string & =~"^https://"
	interfaces: [#Interface, ...#Interface]
	pricing?: #RoutePricing
	overrides?: close({
		capabilities?: #RouteCapabilityOverrides
		dataHandling?: #DataHandlingOverride
		moderated?:    bool
	})
})
