package catalog

#Provider: close({
	name: string & !=""
	aliases?: [...#Slug]
	credentialModes: [#CredentialMode, ...#CredentialMode]
	headquarteredCountry?: #CountryCode
	capabilities:          #RouteCapabilities
	dataHandling:          #ProviderDataHandling
	periods?: [#Period, ...#Period]
})
