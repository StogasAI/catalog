package catalog

#Author: close({
	name: string & !=""
	aliases?: [...#Slug]
	// The company that the author belongs to, which gives its headquarters.
	companyId: #Id
	notes?: #Note
	periods?: [#Period, ...#Period]
})
