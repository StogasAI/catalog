package catalog

#Id:          string & =~"^[a-z0-9][a-z0-9._:-]*$"
#Slug:        string & =~"^[a-z0-9][a-z0-9._:/+-]*$"
#UpstreamId:  string & !=""
#Date:        string & =~"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
#MaybeDate:   null | #Date
#AtomUSD:     string & =~"^[0-9]+$"
#CountryCode: string & =~"^[A-Z]{2}$"

#Modality:        "text" | "image" | "audio" | "video"
#Flavor:          "base" | "instruct" | "search" | "preview" | "code" | "unknown"
#ReasoningEffort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
#Interface:       "chat_completions" | "responses"

#LifecycleStatus: "active" | "deprecated" | "retired"

#TrainingUse:     "no" | "opt_in" | "yes" | "unknown"
#ZDRAvailability: "default" | "contractual" | "unsupported" | "unknown"
#Moderator:       "provider" | "stogas" | "both" | "none" | "unknown"

#TeeStatus:    "attested" | "provider_claimed" | "unverified" | "unknown"
#TeeMechanism: "sev-snp" | "tdx" | "nitro-enclave" | "other" | "unknown"

#Slugs: [#Slug, ...#Slug]
