package catalog

#Id:          string & =~"^[a-z0-9][a-z0-9._:-]*$"
#Slug:        string & =~"^[a-z0-9][a-z0-9._:+-]*$"
#UpstreamId:  string & !=""
#Date:        string & =~"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
#MaybeDate:   null | #Date
#Timestamp:   string & =~"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"
#USD: string & =~"^(0|[1-9][0-9]{0,11})([.][0-9]{0,35}[1-9])?$|^1000000000000$"
#CountryCode:
	"AD" | "AE" | "AF" | "AG" | "AI" | "AL" | "AM" | "AO" | "AQ" | "AR" | "AS" | "AT" | "AU" | "AW" | "AX" | "AZ" |
	"BA" | "BB" | "BD" | "BE" | "BF" | "BG" | "BH" | "BI" | "BJ" | "BL" | "BM" | "BN" | "BO" | "BQ" | "BR" | "BS" | "BT" | "BV" | "BW" | "BY" | "BZ" |
	"CA" | "CC" | "CD" | "CF" | "CG" | "CH" | "CI" | "CK" | "CL" | "CM" | "CN" | "CO" | "CR" | "CU" | "CV" | "CW" | "CX" | "CY" | "CZ" |
	"DE" | "DJ" | "DK" | "DM" | "DO" | "DZ" |
	"EC" | "EE" | "EG" | "EH" | "ER" | "ES" | "ET" |
	"FI" | "FJ" | "FK" | "FM" | "FO" | "FR" |
	"GA" | "GB" | "GD" | "GE" | "GF" | "GG" | "GH" | "GI" | "GL" | "GM" | "GN" | "GP" | "GQ" | "GR" | "GS" | "GT" | "GU" | "GW" | "GY" |
	"HK" | "HM" | "HN" | "HR" | "HT" | "HU" |
	"ID" | "IE" | "IL" | "IM" | "IN" | "IO" | "IQ" | "IR" | "IS" | "IT" |
	"JE" | "JM" | "JO" | "JP" |
	"KE" | "KG" | "KH" | "KI" | "KM" | "KN" | "KP" | "KR" | "KW" | "KY" | "KZ" |
	"LA" | "LB" | "LC" | "LI" | "LK" | "LR" | "LS" | "LT" | "LU" | "LV" | "LY" |
	"MA" | "MC" | "MD" | "ME" | "MF" | "MG" | "MH" | "MK" | "ML" | "MM" | "MN" | "MO" | "MP" | "MQ" | "MR" | "MS" | "MT" | "MU" | "MV" | "MW" | "MX" | "MY" | "MZ" |
	"NA" | "NC" | "NE" | "NF" | "NG" | "NI" | "NL" | "NO" | "NP" | "NR" | "NU" | "NZ" |
	"OM" |
	"PA" | "PE" | "PF" | "PG" | "PH" | "PK" | "PL" | "PM" | "PN" | "PR" | "PS" | "PT" | "PW" | "PY" |
	"QA" |
	"RE" | "RO" | "RS" | "RU" | "RW" |
	"SA" | "SB" | "SC" | "SD" | "SE" | "SG" | "SH" | "SI" | "SJ" | "SK" | "SL" | "SM" | "SN" | "SO" | "SR" | "SS" | "ST" | "SV" | "SX" | "SY" | "SZ" |
	"TC" | "TD" | "TF" | "TG" | "TH" | "TJ" | "TK" | "TL" | "TM" | "TN" | "TO" | "TR" | "TT" | "TV" | "TW" | "TZ" |
	"UA" | "UG" | "UM" | "US" | "UY" | "UZ" |
	"VA" | "VC" | "VE" | "VG" | "VI" | "VN" | "VU" |
	"WF" | "WS" |
	"YE" | "YT" |
	"ZA" | "ZM" | "ZW"
#Uuid:        string & =~"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"

#Modality:        "text" | "image" | "audio" | "video"
#ReasoningEffort: "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
#Reasoning:       "unsupported" | "optional" | "required"
#CredentialMode:  "managed" | "byok"
#Interface:       "chat_completions" | "responses"
#ProcessingLocation: "world" | "apac" | "eu" | "europe" | "unknown" | #CountryCode
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
