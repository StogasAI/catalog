package catalog

// A place that data handling can name. Every place but world lies in the places that parentIds
// lists.
#Location: close({
	name: string & !=""
	parentIds?: [...#LocationId]
})
