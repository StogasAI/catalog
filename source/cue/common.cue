package catalog

// A request's model field separates terms with spaces and kinds with ':', and reads the text
// before a '/' as an author, so IDs and aliases use none of them.
// unknown is the value of a fact that no source states, so no node takes it as its ID.
#Id:          string & =~"^[a-z0-9][a-z0-9._-]*$" & !="unknown"
#Slug:        string & =~"^[a-z0-9][a-z0-9._+-]*$"
#UpstreamId:  string & !=""
#Date:        string & =~"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
#Timestamp:   string & =~"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"
#USD: string & =~"^(0|[1-9][0-9]{0,11})([.][0-9]{0,35}[1-9])?$|^1000000000000$"
// A place that locations lists: an uppercase ISO 3166 code for a country, or for a subdivision
// after its country's code, or a lowercase name for a region. unknown and none are values, not
// places.
#LocationId:  string & =~"^([A-Z]{2}(-[A-Z0-9]{1,3})?|[a-z][a-z0-9]*(-[a-z0-9]+)*)$" & !="unknown" & !="none"
#CountryCode: string & =~"^[A-Z]{2}$"
#Uuid:        string & =~"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"

// One or two plain sentences on one line, at most 300 characters.
#Sentences: string & =~"^[A-Z][^\\n]{0,298}\\.$"
// What a reader needs to know about a node that would surprise them and that no field can say,
// such as an account setting that a model needs before it answers. Most nodes have none. Policies
// never read it, so it never holds a fact that a field can hold.
#Note: #Sentences

#Modality:        "text" | "image" | "audio" | "video"
#ReasoningEffort: "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
#Reasoning:       "unsupported" | "optional" | "required"
#Interface:       "chat_completions" | "responses" | "messages"
#ProcessingLocation: "unknown" | #LocationId
#StorageLocation:    "none" | #ProcessingLocation

#ReasoningMaxTokens: close({
	minimum: int & >0
	maximum: int & >=minimum
})

// What a model does when a request sets no reasoning control: none when it does not reason, the
// effort that it runs at, or enabled when it reasons without a named effort.
#ReasoningDefault: "none" | "enabled" | #ReasoningEffort

// The sampling parameters of a request. A route states those that its API takes, and a model or
// deployment can only take away what its routes take.
#Sampling: close({
	temperature:       bool
	topP:              bool
	topK:              bool
	frequencyPenalty:  bool
	presencePenalty:   bool
	repetitionPenalty: bool
	seed:              bool
	logitBias:         bool
})

#UnsupportedSampling: close({
	temperature?:       false
	topP?:              false
	topK?:              false
	frequencyPenalty?:  false
	presencePenalty?:   false
	repetitionPenalty?: false
	seed?:              false
	logitBias?:         false
})

// The provider's limits on what one request carries, each omitted when the provider states none.
// requestBytes is the largest request body. For images and documents, count is the most parts in
// one request, bytes the largest file before any encoding, and totalBytes the most that all of
// them hold together; pixels is an image's longest side, and pages the most pages that the
// request's documents hold together. A megabyte counts as 1,000,000 bytes, the smaller reading,
// and a limit that the provider states on the base64 text is three quarters of it.
#InputLimits: close({
	requestBytes?: int & >0
	images?: close({
		count?:      int & >0
		bytes?:      int & >0
		totalBytes?: int & >0
		pixels?:     int & >0
	})
	documents?: close({
		count?:      int & >0
		bytes?:      int & >0
		totalBytes?: int & >0
		pages?:      int & >0
	})
})

#WeightPrecision:       "fp32" | "bf16" | "fp16" | "fp8" | "fp6" | "fp4" | "nvfp4" | "mxfp4" | "int8" | "int4"

// A dotted path to a field of the node that owns the period, such as
// pricing.input_tokens.per_mill_tokens. A key below the first can be an ID, as in
// overrides.accountOptions.modified-abuse-monitoring.
#FieldPath: string & =~"^[a-z][A-Za-z0-9_]*([.][a-z0-9][A-Za-z0-9_-]*)*$"

// A dated change to one node, such as a promotion or an announced price change.
// From start until end, each set path takes its value, null included, and each
// unset path is removed. An omitted end lasts until the catalog changes. The name
// tells readers why the facts differ, such as "November output discount".
#Period: close({
	name:  string & !=""
	start: #Timestamp
	end?:  #Timestamp
	set?: close({[#FieldPath]: _})
	unset?: [#FieldPath, ...#FieldPath]
})
