package catalog

#Author: close({
	name: string & !=""
	aliases?: [...#Slug]
	headquarteredCountry: #CountryCode
	notes?: #Note
	periods?: [#Period, ...#Period]
})
