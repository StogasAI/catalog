package catalog

#HostedToolId: "web_search" | "web_fetch" | "mcp"

// Where the tool's own processing sends request content, and what it keeps.
// The gateway joins these facts with the deployment's for each request that
// lists the tool, so a field can only make the deployment's value worse: a
// location joins to the smallest place that holds both, a retention to the
// longer one, unknown retention wins, training use turns unknown and then
// true, the other flags can only turn false, sharedWith adds the companies
// that the tool sends content to, and withoutCertifications removes the audits
// and agreements that do not cover the tool. An omitted field leaves the
// deployment's value.
#HostedToolDataHandling: close({
	processingLocation?: #ProcessingLocation
	storageLocation?:    #ProcessingLocation
	retentionDays?:      null | (int & >=0)
	trainingUse?:        null | true
	zeroDataRetention?:  false
	endToEndEncrypted?:  false
	tee?:                false
	teeVerified?:        false
	sharedWith?: [#CompanyRef, ...#CompanyRef]
	withoutCertifications?: [#Certification, ...#Certification]
})

#HostedTool: close({
	tool: #HostedToolId
	pricing?: #HostedToolPricing
	// Omitted when the tool's processing changes none of the deployment's facts.
	dataHandling?: #HostedToolDataHandling
})
