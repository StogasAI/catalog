import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const driverUrl = new URL('./build-release.mjs', import.meta.url).href;
const json = (value) => `${JSON.stringify(value)}\n`;
const digest = (value) => createHash('sha256').update(value).digest('hex');

function fixture(t, probe = '') {
	const parent = mkdtempSync(join(tmpdir(), 'stogas-catalog-isolation-'));
	t.after(() => rmSync(parent, { recursive: true, force: true }));
	const root = join(parent, 'catalog');
	mkdirSync(root);
	const publicBytes = json({ schema: 'stogas.catalog.public.v3', graph: {} });
	const canary = `test-publication-canary-${randomUUID()}`;
	const secretFile = join(parent, 'publisher-secret');
	writeFileSync(secretFile, canary);
	writeFileSync(
		join(root, 'package.json'),
		json({
			name: 'catalog-isolation-fixture',
			private: true,
			scripts: { build: 'node build.mjs', check: 'node --check build.mjs' }
		})
	);
	writeFileSync(
		join(root, 'build.mjs'),
		`
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
const runtime = { schema: 'stogas.catalog.runtime.v3', graph: {}, publicDigest: ${JSON.stringify(`sha256:${digest(publicBytes)}`)}, containerId: hostname() };
mkdirSync('generated', { recursive: true });
writeFileSync('generated/catalog.runtime.json', JSON.stringify(runtime));
writeFileSync('generated/catalog.public.json', ${JSON.stringify(publicBytes)});
const secretFile = ${JSON.stringify(secretFile)};
const canary = ${JSON.stringify(canary)};
${probe}
`
	);
	run('git', ['init', '--quiet'], root);
	run('git', ['add', '.'], root);
	run(
		'git',
		[
			'-c',
			'user.name=Test',
			'-c',
			'user.email=test@example.invalid',
			'commit',
			'--quiet',
			'-m',
			'fixture'
		],
		root
	);
	return { root, canary, secretFile, publicBytes };
}

function run(command, args, cwd) {
	const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 30_000 });
	assert.equal(result.status, 0, result.stderr);
	return result.stdout;
}

function build(source) {
	return spawnSync(
		process.execPath,
		[
			'--input-type=module',
			'--eval',
			`
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCatalogRelease } from ${JSON.stringify(driverUrl)};
writeFileSync(join(process.argv[1], 'publisher-pid'), String(process.pid));
buildCatalogRelease(process.argv[1]);`,
			source.root
		],
		{
			encoding: 'utf8',
			timeout: 15 * 60 * 1000,
			maxBuffer: 1024 * 1024,
			env: {
				...process.env,
				CLOUDFLARE_API_TOKEN: source.canary,
				AWS_SECRET_ACCESS_KEY: source.canary,
				GH_TOKEN: source.canary
			}
		}
	);
}

test(
	'build scripts cannot read publisher state, modify host files, or leave a running container',
	{ timeout: 900_000 },
	(t) => {
		const source = fixture(
			t,
			`
assert.notEqual(process.getuid(), 0);
assert.match(readFileSync('/proc/self/status', 'utf8'), /^CapEff:\\s+0+$/m);
assert.match(readFileSync('/proc/self/status', 'utf8'), /^NoNewPrivs:\\s+1$/m);
for (const key of ['CLOUDFLARE_API_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'GH_TOKEN']) {
	assert.equal(process.env[key], undefined);
}
assert.throws(() => readFileSync(secretFile), { code: 'ENOENT' });
assert.throws(() => readFileSync('/var/run/docker.sock'), { code: 'ENOENT' });
assert.throws(() => writeFileSync('/source/build.mjs', 'changed'), /EROFS|EACCES/);
const parentPid = readFileSync('/source/publisher-pid', 'utf8');
let parentEnvironment = '';
try { parentEnvironment = readFileSync('/proc/' + parentPid + '/environ', 'utf8'); }
catch (error) { assert.match(error.code, /ENOENT|EACCES/); }
assert.equal(parentEnvironment.includes(canary), false);
const helper = spawn(process.execPath, ['--input-type=module', '--eval',
	"import { writeFileSync } from 'node:fs'; setInterval(() => { try { writeFileSync(" + JSON.stringify(secretFile) + ", 'changed'); } catch {} }, 10);"
], { detached: true, stdio: 'ignore' });
helper.unref();
`
		);
		const result = build(source);
		assert.equal(result.status, 0, result.stderr);
		assert.equal(readFileSync(source.secretFile, 'utf8'), source.canary);
		assert.equal(
			readFileSync(join(source.root, 'generated/catalog.public.json'), 'utf8'),
			source.publicBytes
		);
		const runtime = JSON.parse(
			readFileSync(join(source.root, 'generated/catalog.runtime.json'), 'utf8')
		);
		assert.match(runtime.containerId, /^[a-f0-9]{12}$/);
		const state = spawnSync('docker', ['inspect', runtime.containerId], { encoding: 'utf8' });
		assert.notEqual(state.status, 0);
		assert.match(state.stderr, /no such object/i);
	}
);

for (const [name, probe, message] of [
	[
		'symlink',
		"rmSync('generated/catalog.runtime.json'); symlinkSync('/etc/hostname', 'generated/catalog.runtime.json');",
		/nonempty regular catalog artifact/
	],
	[
		'oversized artifact',
		"truncateSync('generated/catalog.runtime.json', 16 * 1024 * 1024 + 1);",
		/ENOBUFS/
	],
	[
		'public digest mismatch',
		"runtime.publicDigest = 'sha256:' + '0'.repeat(64); writeFileSync('generated/catalog.runtime.json', JSON.stringify(runtime));",
		/does not commit to the public catalog/
	]
]) {
	test(`rejects ${name} before installing any build output`, { timeout: 900_000 }, (t) => {
		const source = fixture(t, probe);
		mkdirSync(join(source.root, 'generated'));
		const previous = '{"previous":true}\n';
		writeFileSync(join(source.root, 'generated/catalog.runtime.json'), previous);
		const result = build(source);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, message);
		assert.equal(
			readFileSync(join(source.root, 'generated/catalog.runtime.json'), 'utf8'),
			previous
		);
		assert.equal(readFileSync(source.secretFile, 'utf8'), source.canary);
	});
}
