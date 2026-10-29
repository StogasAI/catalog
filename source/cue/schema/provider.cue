package catalog

#Provider: close({
	name: string & !=""
	aliases?: [...#Slug]
	credentialModes: [#CredentialMode, ...#CredentialMode]
	headquarteredCountry?: #CountryCode
	capabilities:          #RouteCapabilities
	dataHandling:          #ProviderDataHandling
	// The date that the provider names for ending its service. Its routes and
	// deployments retire then.
	retirementDate?: #Date
	periods?: [#Period, ...#Period]
})
