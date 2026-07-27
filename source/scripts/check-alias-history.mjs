import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const baseRef = process.argv[2];
if (!baseRef) {
	throw new Error('Usage: node source/scripts/check-alias-history.mjs <base-git-ref>');
}

let previous;
try {
	previous = JSON.parse(
		execFileSync('git', ['show', `${baseRef}:generated/catalog.runtime.json`], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe']
		})
	);
} catch {
	console.log(`No catalog runtime bundle exists at ${baseRef}; skipping alias history check.`);
	process.exit(0);
}

const current = JSON.parse(
	readFileSync(
		fileURLToPath(new URL('../../generated/catalog.runtime.json', import.meta.url)),
		'utf8'
	)
);
const failures = [];

for (const [alias, oldRecord] of Object.entries(previous.aliases ?? {})) {
	if (oldRecord.binding !== 'fixed') continue;
	const nextRecord = current.aliases?.[alias];
	if (!nextRecord) {
		failures.push(`${alias}: fixed alias was removed`);
		continue;
	}
	if (nextRecord.binding !== 'fixed') {
		failures.push(`${alias}: fixed alias became ${nextRecord.binding}`);
	}
	if (nextRecord.deploymentId !== oldRecord.deploymentId) {
		failures.push(
			`${alias}: fixed alias moved from ${oldRecord.deploymentId} to ${nextRecord.deploymentId}`
		);
		continue;
	}
	const oldDeployment = previous.graph?.deployments?.[oldRecord.deploymentId];
	const nextDeployment = current.graph?.deployments?.[nextRecord.deploymentId];
	for (const field of ['modelId', 'upstreamId', 'modelSelection']) {
		if (JSON.stringify(oldDeployment?.[field]) !== JSON.stringify(nextDeployment?.[field])) {
			failures.push(`${alias}: fixed deployment changed ${field}`);
		}
	}
}

if (failures.length) {
	throw new Error(`Fixed alias history is immutable:\n- ${failures.join('\n- ')}`);
}
