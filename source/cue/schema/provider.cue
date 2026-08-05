package catalog

#Provider: close({
	name: string & !=""
	aliases?: [...#Slug]
	credentialModes: [#CredentialMode, ...#CredentialMode]
	headquarteredCountry?: #CountryCode
	capabilities:          #RouteCapabilities
	dataHandling:          #DataHandling
	moderated:             bool
})
