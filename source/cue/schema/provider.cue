package catalog

#Provider: close({
	name: string & !=""
	aliases?: [...#Slug]
	credentialModes: [#CredentialMode, ...#CredentialMode]
	headquarteredCountry: #CountryCode
	// The places where an account's resources can keep data, for providers whose accounts choose
	// one. A credential narrows the storage of the deployments that it serves to its resource's
	// place, so each place must be listed even when no deployment names it.
	accountLocations?: [#LocationId, ...#LocationId]
	capabilities:          #RouteCapabilities
	dataHandling:          #ProviderDataHandling
	// The date that the provider names for ending its service. Its routes and
	// deployments retire then.
	retirementDate?: #Date
	// Stogas serves none of its routes; each of them takes this reason.
	stogasUnsupported?: #UnsupportedReason
	periods?: [#Period, ...#Period]
})
