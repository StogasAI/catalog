package catalog

#ProviderDataHandling: close({
	processingLocation: #ProcessingLocation
	storageLocation:    #StorageLocation
	// Maximum retention of stored prompts and responses; null means unknown.
	// Temporary in-memory prompt caching is excluded.
	retentionDays: null | (int & >=0)
	// Whether the provider trains on prompts and responses; null means unknown.
	trainingUse: null | bool
	// The guarantees below are stated only when they hold; omitted, each is false.
	// No persistent retention of prompts or responses for this offering.
	// Temporary in-memory prompt caching is compatible with ZDR.
	zeroDataRetention?: true
	// tee means provider inference processes request content inside a TEE.
	tee?: true
	// teeVerified is true only when Stogas verifies the approved measured
	// workload for the concrete request target, independent of provider claims.
	teeVerified?: true
	// The companies, other than the provider's company and the hosting, that receive requests and
	// responses: one that passes them on to the hosting, or one that the hosting shares them with,
	// such as the model's developer for abuse monitoring. A company that only supplies
	// infrastructure to one of those two under its contract is not listed. Omitted when the provider
	// documents none.
	sharedWith?: [#CompanyRef, ...#CompanyRef]
	// The audits and authorizations that cover the service, each from a page of the company that
	// runs it which names the service. Omitted when no such page exists.
	certifications?: [#Certification, ...#Certification]
})

// An independent audit or a government authorization of the service that processes requests, or
// the company's offer to sign a HIPAA business associate agreement for it. A record lists one only
// where the company names the service in the audit's scope, because an audit covers a service and
// not everything that a company sells. A self-assessment, such as CSA STAR Level 1, is no entry.
// Whether a customer has signed an agreement is not a fact of the catalog.
#Certification:
	"soc2-type2" |
	"iso-27001" |
	"iso-27017" |
	"iso-27018" |
	"iso-27701" |
	"iso-42001" |
	"pci-dss" |
	"csa-star-level-2" |
	"hipaa-eligible" |
	"fedramp-moderate" |
	"fedramp-high" |
	"dod-il2" |
	"dod-il4" |
	"dod-il5"

// A route states only what differs from its provider. It may state any fact of a deployment's
// override, such as a Chutes route that relays requests to operators outside a TEE, and whether
// requests are encrypted end to end, which is false when omitted.
// A list replaces the provider's whole list, as for a route whose models another company runs under
// that company's own audits.
#RouteDataHandling: close({
	#DeploymentDataHandlingOverride
	endToEndEncrypted?: true
})

#DeploymentDataHandlingOverride: close({
	processingLocation?: #ProcessingLocation
	storageLocation?:    #StorageLocation
	retentionDays?:     null | (int & >=0)
	trainingUse?:       null | bool
	zeroDataRetention?: bool
	tee?:               bool
	teeVerified?:       bool
	sharedWith?: [...#CompanyRef]
	certifications?: [...#Certification]
})
