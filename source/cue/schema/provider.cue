package catalog

#Provider: close({
	name: string & !=""
	aliases?: [...#Slug]
	// The company that sells access through this provider, which gives its headquarters. It runs
	// the provider's models unless a route or a deployment names another hosting.
	companyId: #Id
	// The places where an account's resources can keep data, for providers whose accounts choose
	// one. A credential narrows the storage of the deployments that it serves to its resource's
	// place, so each place must be listed even when no deployment names it.
	accountLocations?: [#LocationId, ...#LocationId]
	// What an account with the provider can hold that changes how the provider handles its
	// requests. A credential states which ones its account holds.
	accountOptions?: [#AccountOption, ...#AccountOption]
	dataHandling: #ProviderDataHandling
	// The date that the provider names for ending its service. Its routes and
	// deployments retire then.
	retirementDate?: #Date
	// Stogas serves the provider's deployments with a customer's own credential, or with its own
	// account, which it bills the customer for. A route or a deployment can withdraw either. The
	// catalog lists what the market offers; the gateway never routes to a record that Stogas
	// serves in neither way.
	stogasByok?:    true
	stogasManaged?: true
	notes?:           #Note
	periods?: [#Period, ...#Period]
})

// An agreement or a setting of a customer's account with the provider that changes the data
// handling of the account's requests, such as zero data retention or a signed business associate
// agreement. Records state the facts of an account that holds none. For a request with a
// credential whose account holds an option, the gateway sets each fact that the option states,
// before it joins the request's hosted tools, and then adds each granted certification to a
// record that lists its -eligible entry. An option changes no upstream, price, limit or TEE fact.
#AccountOption: close({
	id: #Id
	// The provider's own name for the option.
	name: string & !=""
	// A setting with several values: an account holds one option of a group at most.
	group?: #Id
	// The provider's routes whose requests the option covers. It reaches each deployment on
	// them but one that removes it in overrides, one whose own terms leave unknown a fact that
	// the option sets, and one whose model's minimumRetentionDays is over the retention that the
	// option sets.
	routes: [#Id, ...#Id]
	dataHandling?: close({
		storageLocation?:   #StorageLocation
		retentionDays?:     int & >=0
		trainingUse?:       bool
		zeroDataRetention?: true
	})
	// The certifications that hold once the account holds the option.
	grants?: [#GrantedCertification, ...#GrantedCertification]
})
