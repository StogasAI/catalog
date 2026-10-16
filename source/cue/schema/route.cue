package catalog

// Native document content parts. Image/audio parts follow model modalities.
#NativeFileInputs: close({
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
	urlContext:              bool
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
	urlContext?:              bool
})

#Route: close({
	providerId: #Id
	endpoint?:  string & =~"^https://"
	interfaces: [#Interface, ...#Interface]
	nativeFileInputs: #NativeFileInputs
	dataHandling:     #RouteDataHandling
	pricing?:         #RoutePricing
	overrides?: close({
		capabilities?: #CapabilityOverrides
	})
	periods?: [#Period, ...#Period]
})
