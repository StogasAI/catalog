package catalog

#Provider: close({
	name: string & !=""
	aliases?: [...#Slug]
	headquarteredCountry?: #CountryCode
	capabilities:          #RouteCapabilities
	dataHandling:          #DataHandling
	moderated:             bool
})
