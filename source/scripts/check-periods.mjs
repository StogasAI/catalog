// Lists dated periods to fold into the catalog source. An ended period no longer changes
// anything, and a started period without an end now holds the lasting facts.
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

try {
	const { values } = parseArgs({ options: { help: { type: 'boolean' } } });
	if (values.help) {
		console.log(
			'Usage: bun run check:periods\nLists dated periods to fold into the catalog source.\nExit codes: 0 = none; 1 = periods to fold; 2 = unreadable catalog.'
		);
	} else {
		const catalog = JSON.parse(
			await readFile(new URL('../../generated/catalog.public.json', import.meta.url), 'utf8')
		);
		const now = Date.now();
		const stale = catalog.periods.filter(({ start, end }) => Date.parse(end ?? start) <= now);
		for (const { kind, id, name, start, end } of stale)
			console.log(
				end === null
					? `${kind} ${id}: "${name}" started ${start} without an end; move its changes into the node and remove the period`
					: `${kind} ${id}: "${name}" ended ${end}; remove the period`
			);
		if (stale.length === 0) console.log('No dated period has ended or started without an end.');
		process.exitCode = stale.length > 0 ? 1 : 0;
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 2;
}
