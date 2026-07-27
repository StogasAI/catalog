package catalog

#RouteCapabilities: close({
	streaming:       bool
	functionCalling: bool
	promptCaching:   bool
	systemMessages:  bool
	toolChoice:      bool
	webSearch:       bool
})

#Route: close({
	providerId:   #Id
	interfaces:   [#Interface, ...#Interface]
	capabilities: #RouteCapabilities
	dataHandling: #DataHandling
	moderation:   #Moderation
	pricing?:     #Pricing
})

