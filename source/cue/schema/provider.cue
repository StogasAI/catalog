package catalog

#Provider: close({
	name:                 string & !=""
	aliases:              [...#Slug]
	headquarteredCountry?: #CountryCode
	capabilities?:        #RouteCapabilityOverrides
	dataHandling?:        #DataHandlingOverride
	moderated:            bool
	pricing?:             #Pricing
})
