package catalog

// A company that makes models, sells access to them, runs them or receives their requests. An
// author and a provider each name theirs, so one company can make models and sell access through
// several providers. A route or a deployment names the company that runs its models when that is
// not its provider's, and data handling names the companies that requests are shared with.
#Company: close({
	name:                 string & !=""
	headquarteredCountry: #CountryCode
})

// A company that companies lists, or unknown for one that the provider does not name.
#CompanyRef: #Id | "unknown"
