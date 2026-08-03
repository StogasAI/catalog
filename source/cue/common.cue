package catalog

#Id:          string & =~"^[a-z0-9][a-z0-9._:-]*$"
#Slug:        string & =~"^[a-z0-9][a-z0-9._:+-]*$"
#UpstreamId:  string & !=""
#Date:        string & =~"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
#MaybeDate:   null | #Date
#AtomUSD:     string & =~"^[0-9]+$"
#CountryCode: string & =~"^[A-Z]{2}$"
#Uuid:        string & =~"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
#GitRevision: string & =~"^[0-9a-f]{40}$"

#Modality:        "text" | "image" | "audio" | "video"
#Flavor:          "base" | "instruct" | "chat" | "search" | "code" | "unknown"
#ReasoningEffort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
#Interface:       "chat_completions" | "responses"

#TeeStatus:             "attested" | "claimed" | "unverified" | "unknown"
#TeeMechanism:          "sev-snp" | "tdx" | "nitro-enclave" | "other" | "unknown"
#ExternalNetworkEgress: "blocked" | "allowed" | "unknown"
#WeightPrecision:       "fp32" | "bf16" | "fp16" | "fp8" | "fp6" | "fp4" | "nvfp4" | "mxfp4" | "int8" | "int4"

#Tee: close({
	status:                #TeeStatus
	mechanism:             #TeeMechanism
	externalNetworkEgress: #ExternalNetworkEgress
})

#TeeOverride: close({
	status?:                #TeeStatus
	mechanism?:             #TeeMechanism
	externalNetworkEgress?: #ExternalNetworkEgress
})
