// Writes the in-toto statement that GitLab's rebuild signs: the release manifest and the catalog
// root, the two files that GitHub's proof names.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOG_ROOT, sha256 } from './release-format.mjs';

const [release] = process.argv.slice(2);
const environment = process.env;
const project = environment.CI_PROJECT_URL;
const ref = `refs/tags/${environment.CI_COMMIT_TAG}`;

const statement = {
	_type: 'https://in-toto.io/Statement/v1',
	subject: ['catalog-release.json', CATALOG_ROOT].map((name) => ({
		name,
		digest: { sha256: sha256(readFileSync(join(release, name))) }
	})),
	predicateType: 'https://slsa.dev/provenance/v1',
	predicate: {
		buildDefinition: {
			buildType: 'https://stogas.ai/docs/reproducible-builds#rebuild-a-catalog',
			externalParameters: { source: project, ref, configuration: '.gitlab-ci.yml' },
			resolvedDependencies: [
				{ uri: `git+${project}@${ref}`, digest: { gitCommit: environment.CI_COMMIT_SHA } }
			]
		},
		runDetails: {
			builder: { id: `${project}/-/runners/${environment.CI_RUNNER_ID}` },
			metadata: {
				invocationId: environment.CI_PIPELINE_URL,
				startedOn: environment.CI_PIPELINE_CREATED_AT,
				finishedOn: new Date().toISOString().replace(/\.\d+Z$/, 'Z')
			}
		}
	}
};
process.stdout.write(`${JSON.stringify(statement, null, 2)}\n`);
