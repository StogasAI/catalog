package catalog

#Group: close({
	authorId: #Id
	name: string & !=""
	parentIds?: [...#Id]
	notes?: #Note
	periods?: [#Period, ...#Period]
})
