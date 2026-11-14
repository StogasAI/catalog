package catalog

#Provider: close({
	name: string & !=""
	aliases?: [...#Slug]
	credentialModes: [#CredentialMode, ...#CredentialMode]
	// The company that sells access through this provider, which gives its headquarters. It runs
	// the provider's models unless a route or a deployment names another hosting.
	companyId: #Id
	// The places where an account's resources can keep data, for providers whose accounts choose
	// one. A credential narrows the storage of the deployments that it serves to its resource's
	// place, so each place must be listed even when no deployment names it.
	accountLocations?: [#LocationId, ...#LocationId]
	capabilities:          #RouteCapabilities
	dataHandling:          #ProviderDataHandling
	// The date that the provider names for ending its service. Its routes and
	// deployments retire then.
	retirementDate?: #Date
	// Stogas serves none of its routes. The catalog lists what the market offers; the gateway never
	// routes to a record that Stogas does not serve.
	stogasSupported?: false
	notes?:           #Note
	periods?: [#Period, ...#Period]
})
