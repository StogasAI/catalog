import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG_ARCHIVE_LIMIT } from './public-catalog.mjs';
import {
	CATALOG_ARCHIVE_FILE,
	CATALOG_ARTIFACT_LIMITS,
	catalogArchiveReference,
	checkCatalogArtifactSize,
	sha256
} from './release-format.mjs';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const maxSnapshotBytes = 128 * 1024 * 1024;

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
		const runtime = readArtifact(container, 'catalog.runtime.json');
		const publicCatalog = readArtifact(container, 'catalog.public.json');
		if (JSON.parse(runtime).publicDigest !== `sha256:${sha256(publicCatalog)}`) {
			throw new Error('Isolated runtime does not commit to the public catalog.');
		}
		const reference = catalogArchiveReference(publicCatalog);
		const archive = reference && readArtifact(container, CATALOG_ARCHIVE_FILE);
		if (archive && (archive.length !== reference.size || sha256(archive) !== reference.sha256)) {
			throw new Error('Isolated archive differs from the public catalog.');
		}
		if (captureSource(root).digest !== source.digest) {
			throw new Error('Catalog source changed during the isolated release build.');
		}
		installArtifacts(root, [
			['catalog.runtime.json', runtime],
			['catalog.public.json', publicCatalog],
			[CATALOG_ARCHIVE_FILE, archive]
		]);
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

function readArtifact(container, path) {
	const limit =
		path === CATALOG_ARCHIVE_FILE ? CATALOG_ARCHIVE_LIMIT : CATALOG_ARTIFACT_LIMITS[path];
	const archive = run('docker', ['cp', `${container}:/workspace/generated/${path}`, '-'], {
		maxBuffer: limit + 1024 * 1024
	});
	const bytes = run('tar', ['-xOf', '-', '--', basename(path)], {
		input: archive,
		maxBuffer: limit
	});
	if (!bytes.length) throw new Error(`${path} must be a nonempty regular catalog artifact.`);
	// The container's own warning stays inside it.
	checkCatalogArtifactSize(path, bytes.length);
	return bytes;
}

/** Writes each artifact in place, and removes one that the build no longer makes. */
function installArtifacts(root, artifacts) {
	const generated = join(root, 'generated');
	mkdirSync(generated, { recursive: true });
	if (!lstatSync(generated).isDirectory() || lstatSync(generated).isSymbolicLink()) {
		throw new Error('The catalog output directory must not be a symbolic link.');
	}
	for (const [name, bytes] of artifacts) {
		const target = join(generated, name);
		if (!bytes) {
			rmSync(target, { force: true });
			continue;
		}
		const temporary = `${target}.${randomUUID()}.tmp`;
		try {
			writeFileSync(temporary, bytes, { mode: 0o644, flag: 'wx' });
			renameSync(temporary, target);
		} finally {
			rmSync(temporary, { force: true });
		}
	}
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
