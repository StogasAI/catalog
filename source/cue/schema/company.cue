package catalog

// A company that makes models, sells access to them, runs them or receives their requests. An
// author and a provider each name theirs, so one company can make models and sell access through
// several providers. A route or a deployment names the company that runs its models when that is
// not its provider's, and data handling names the companies that requests are shared with.
//
// A company is a corporate group, named as its customers know it, with the headquarters of the
// company that controls the group, because that company decides what happens to the data and its
// country's law reaches every part of the group. A subsidiary or a regional entity that sells or
// runs the group's services, such as Amazon Web Services or Google Cloud EMEA, is the group, and the
// place where it works is a location. A product, such as Bedrock, is a route, and a model brand,
// such as Qwen, is an author.
#Company: close({
	name:                 string & !=""
	headquarteredCountry: #CountryCode
})

// A company that companies lists, or unknown for one that the provider does not name.
#CompanyRef: #Id | "unknown"
