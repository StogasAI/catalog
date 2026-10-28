import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG_ROOT_LIMIT } from './catalog-files.mjs';
import {
	CATALOG_PARTS_DIRECTORY,
	CATALOG_ROOT,
	catalogFileList,
	sha256
} from './release-format.mjs';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
// The source and the tracked generated files, which take at most 128 MiB.
const maxSnapshotBytes = 256 * 1024 * 1024;

// Only this reviewed driver and the publisher run on the host. Package scripts
// and their dependencies run in a container with no host process or write access.
export function buildCatalogRelease(root = repositoryRoot) {
	const work = mkdtempSync(join(tmpdir(), 'stogas-catalog-build-'));
	let container;
	try {
		const source = captureSource(root);
		const snapshot = join(work, 'source');
		mkdirSync(snapshot, { mode: 0o755 });
		for (const file of source.files) {
			const path = join(snapshot, file.path);
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, file.bytes, { mode: file.executable ? 0o755 : 0o644 });
		}
		// The image build receives an empty context, never the source or host state.
		const context = join(work, 'context');
		mkdirSync(context);
		const imageFile = join(work, 'image');
		run('docker', [
			'build',
			'--quiet',
			'--iidfile',
			imageFile,
			'--file',
			fileURLToPath(new URL('./release-build.Dockerfile', import.meta.url)),
			context
		]);
		const image = readFileSync(imageFile, 'utf8').trim();
		if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error('Invalid catalog build image ID.');
		container = run('docker', [
			'create',
			'--init',
			'--cap-drop=ALL',
			'--security-opt=no-new-privileges',
			'--pids-limit=256',
			'--memory=4g',
			'--cpus=2',
			'--user=1000:1000',
			'--mount',
			`type=bind,source=${snapshot},target=/source,readonly,bind-recursive=disabled`,
			image,
			'sh',
			'-ec',
			[
				'cp -R /source/. /workspace/',
				'git init --quiet',
				'git add .',
				'git -c user.name=Catalog -c user.email=catalog@example.invalid commit --quiet -m snapshot',
				'bun install --frozen-lockfile',
				'bun run build',
				'bun run check'
			].join('\n')
		])
			.toString()
			.trim();
		if (!/^[a-f0-9]{64}$/.test(container)) throw new Error('Invalid catalog build container ID.');
		run('docker', ['start', '--attach', container]);
		const state = JSON.parse(run('docker', ['inspect', '--format', '{{json .State}}', container]));
		if (state.Running || state.ExitCode !== 0 || state.OOMKilled) {
			throw new Error('Catalog release checks did not finish successfully.');
		}
		// Docker has stopped every process before any output crosses the boundary.
		// Read individual files through bounded tar streams; never extract a tree.
		const catalog = readRoot(container);
		const parts = readParts(container, work, catalog);
		if (captureSource(root).digest !== source.digest) {
			throw new Error('Catalog source changed during the isolated release build.');
		}
		installArtifacts(root, catalog, parts);
		console.log('Catalog release build and checks passed in an isolated container.');
	} finally {
		try {
			if (container && /^[a-f0-9]{64}$/.test(container))
				run('docker', ['rm', '--force', container]);
		} finally {
			rmSync(work, { recursive: true, force: true });
		}
	}
}

function captureSource(root) {
	const paths = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
		cwd: root
	})
		.toString()
		.split('\0')
		.filter(Boolean)
		.sort();
	const hash = createHash('sha256');
	hash.update(run('git', ['rev-parse', 'HEAD', 'HEAD^{tree}'], { cwd: root }));
	let size = 0;
	const files = [];
	for (const path of new Set(paths)) {
		if (
			path.startsWith('/') ||
			path.split('/').some((part) => !part || part === '.' || part === '..')
		) {
			throw new Error('Invalid catalog source path.');
		}
		const absolute = join(root, path);
		let stats;
		try {
			stats = lstatSync(absolute);
		} catch (error) {
			if (error.code === 'ENOENT') continue;
			throw error;
		}
		if (!stats.isFile() || stats.isSymbolicLink())
			throw new Error(`${path} must be a regular source file.`);
		size += stats.size;
		if (size > maxSnapshotBytes) throw new Error('Catalog source snapshot is too large.');
		const bytes = readFileSync(absolute);
		const executable = (stats.mode & 0o111) !== 0;
		hash
			.update(path)
			.update('\0')
			.update(executable ? 'x' : '-')
			.update(bytes)
			.update('\0');
		files.push({ path, bytes, executable });
	}
	return { files, digest: hash.digest('hex') };
}

function readRoot(container) {
	const archive = run('docker', ['cp', `${container}:/workspace/generated/${CATALOG_ROOT}`, '-'], {
		maxBuffer: CATALOG_ROOT_LIMIT + 1024 * 1024
	});
	const bytes = run('tar', ['-xOf', '-', '--', CATALOG_ROOT], {
		input: archive,
		maxBuffer: CATALOG_ROOT_LIMIT
	});
	if (!bytes.length) throw new Error(`${CATALOG_ROOT} must be a nonempty regular file.`);
	return bytes;
}

/**
 * The parts that the root names, read from one bounded tar stream of the parts directory with one
 * more tar run, which writes them one after another in the archive's order.
 */
function readParts(container, work, catalog) {
	// The container's own warnings stay inside it.
	const listed = new Map(
		catalogFileList(catalog).map(({ sha256: digest, size }) => [
			`${CATALOG_PARTS_DIRECTORY}/${digest}.json`,
			{ digest, size }
		])
	);
	if (!listed.size) return new Map();
	const total = [...listed.values()].reduce((sum, { size }) => sum + size, 0);
	const archive = join(work, 'parts.tar');
	writeFileSync(
		archive,
		run('docker', ['cp', `${container}:/workspace/generated/${CATALOG_PARTS_DIRECTORY}`, '-'], {
			// Each member takes a header block and pads its last block.
			maxBuffer: total + (listed.size + 2) * 1024 + 10240
		})
	);
	const names = run('tar', ['-tf', archive], { maxBuffer: (listed.size + 2) * 1024 })
		.toString()
		.split('\n')
		.filter((name) => listed.has(name));
	if (names.length !== listed.size || new Set(names).size !== names.length)
		throw new Error('The isolated catalog parts differ from the root.');
	const bytes = run('tar', ['-xOf', archive, '--', ...names], { maxBuffer: total });
	if (bytes.length !== total) throw new Error('The isolated catalog parts differ from the root.');
	const parts = new Map();
	let offset = 0;
	for (const name of names) {
		const { digest, size } = listed.get(name);
		const part = bytes.subarray(offset, (offset += size));
		if (sha256(part) !== digest)
			throw new Error(`Isolated catalog part ${digest} differs from the root.`);
		parts.set(`${digest}.json`, part);
	}
	return parts;
}

/**
 * Writes the root and each part in place, and removes every other generated file, such as parts
 * that the root no longer names.
 */
function installArtifacts(root, catalog, parts) {
	const generated = join(root, 'generated');
	const partsDirectory = join(generated, CATALOG_PARTS_DIRECTORY);
	mkdirSync(partsDirectory, { recursive: true });
	for (const directory of [generated, partsDirectory]) {
		if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) {
			throw new Error('The catalog output directories must not be symbolic links.');
		}
	}
	// Parts first, so the root never names a part that is not there yet.
	const entries = [
		...[...parts].map(([name, bytes]) => [join(partsDirectory, name), bytes]),
		[join(generated, CATALOG_ROOT), catalog]
	];
	for (const [target, bytes] of entries) {
		const temporary = `${target}.${randomUUID()}.tmp`;
		try {
			writeFileSync(temporary, bytes, { mode: 0o644, flag: 'wx' });
			renameSync(temporary, target);
		} finally {
			rmSync(temporary, { force: true });
		}
	}
	for (const name of readdirSync(partsDirectory))
		if (!parts.has(name)) rmSync(join(partsDirectory, name), { force: true });
	for (const name of readdirSync(generated))
		if (name !== CATALOG_ROOT && name !== CATALOG_PARTS_DIRECTORY)
			rmSync(join(generated, name), { force: true, recursive: true });
}

function run(command, args, options = {}) {
	const env = {};
	for (const name of [
		'PATH',
		'HOME',
		'LANG',
		'LC_ALL',
		'DOCKER_HOST',
		'DOCKER_CONTEXT',
		'DOCKER_CONFIG',
		'DOCKER_TLS_VERIFY',
		'DOCKER_CERT_PATH'
	]) {
		if (process.env[name] !== undefined) env[name] = process.env[name];
	}
	const result = spawnSync(command, args, {
		cwd: repositoryRoot,
		env,
		maxBuffer: 8 * 1024 * 1024,
		timeout: 15 * 60 * 1000,
		stdio: ['pipe', 'pipe', 'pipe'],
		...options
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`${command} failed: ${result.stderr?.toString().trim()}`);
	}
	return result.stdout;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	if (process.argv.length !== 2) throw new Error('Use: build-release.mjs');
	buildCatalogRelease();
}
