package catalog

#Id:          string & =~"^[a-z0-9][a-z0-9._:-]*$"
#Slug:        string & =~"^[a-z0-9][a-z0-9._:+-]*$"
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

#Modality:        "text" | "image" | "audio" | "video"
#ReasoningEffort: "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
#Reasoning:       "unsupported" | "optional" | "required"
#CredentialMode:  "managed" | "byok"
#Interface:       "chat_completions" | "responses"
#ProcessingLocation: "unknown" | #LocationId
#StorageLocation:    "none" | #ProcessingLocation

#ReasoningMaxTokens: close({
	minimum: int & >0
	maximum: int & >=minimum
})

#WeightPrecision:       "fp32" | "bf16" | "fp16" | "fp8" | "fp6" | "fp4" | "nvfp4" | "mxfp4" | "int8" | "int4"

// A dotted path to a field of the node that owns the period, such as
// pricing.input_tokens.per_mill_tokens.
#FieldPath: string & =~"^[a-z][A-Za-z0-9_]*([.][a-z][A-Za-z0-9_]*)*$"

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
