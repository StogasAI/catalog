import { spawn } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, type Plugin } from 'vite';

const editorRoot = dirname(fileURLToPath(import.meta.url));
const catalogRoot = resolve(editorRoot, '../source');
const dataRoot = join(catalogRoot, 'data');
const yamlPattern = /\.(ya?ml)$/;
const EDITOR_PORT = 5177;
const MAX_BUILD_OUTPUT_BYTES = 1024 * 1024;
const MAX_SOURCE_BODY_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_FILE_BYTES = 1024 * 1024;

export default defineConfig(({ command }) => {
	const base = command === 'serve' ? developmentBase() : '/';
	return {
		base,
		root: editorRoot,
		build: { assetsInlineLimit: 0 },
		plugins: [catalogApi(base), svelte()],
		server: {
			allowedHosts: ['code.stogas.ai'],
			port: EDITOR_PORT,
			strictPort: true
		}
	};
});

function developmentBase() {
	const proxyUri = process.env.VSCODE_PROXY_URI;
	if (!proxyUri) return '/';
	const url = new URL(proxyUri.replace('{{port}}', String(EDITOR_PORT)), 'http://localhost');
	return url.pathname.replace('/proxy/', '/absproxy/');
}

function catalogApi(base: string): Plugin {
	const apiBase = `${base}api/catalog`;
	return {
		name: 'stogas-catalog-api',
		configureServer(server) {
			server.middlewares.use(`${apiBase}/sources`, async (req, res) => {
				if (req.method !== 'GET') {
					sendJson(res, { error: 'Method not allowed' }, 405);
					return;
				}
				try {
					sendJson(res, readSources());
				} catch (error) {
					sendJson(res, { error: errorMessage(error) }, 500);
				}
			});
			server.middlewares.use(`${apiBase}/source`, async (req, res) => {
				if (req.method !== 'PUT') {
					sendJson(res, { error: 'Method not allowed' }, 405);
					return;
				}
				if (!sameOriginWriteRequest(req)) {
					sendJson(res, { error: 'Cross-origin write rejected' }, 403);
					return;
				}
				let input: unknown;
				try {
					input = JSON.parse(await readBody(req));
				} catch (error) {
					sendJson(
						res,
						{ error: errorMessage(error) },
						error instanceof BodyTooLargeError ? 413 : 400
					);
					return;
				}
				if (!isRecord(input)) {
					sendJson(res, { error: 'Expected YAML path and content' }, 400);
					return;
				}
				const { path, content } = input;
				if (
					typeof path !== 'string' ||
					!path ||
					typeof content !== 'string' ||
					!yamlPattern.test(path)
				) {
					sendJson(res, { error: 'Expected YAML path and content' }, 400);
					return;
				}
				if (Buffer.byteLength(content) > MAX_SOURCE_FILE_BYTES) {
					sendJson(res, { error: 'Catalog source is too large' }, 413);
					return;
				}
				const absolute = safeCatalogPath(path);
				if (!absolute) {
					sendJson(res, { error: 'Path is not an existing catalog data file' }, 400);
					return;
				}
				writeFileSync(absolute, content);
				sendJson(res, { ok: true });
			});
			server.middlewares.use(`${apiBase}/build`, async (req, res) => {
				if (req.method !== 'POST') {
					sendJson(res, { error: 'Method not allowed' }, 405);
					return;
				}
				if (!sameOriginWriteRequest(req)) {
					sendJson(res, { error: 'Cross-origin write rejected' }, 403);
					return;
				}
				try {
					const output = await run([process.execPath, 'scripts/build.mjs'], catalogRoot);
					sendJson(res, { ok: true, output });
				} catch (error) {
					sendJson(
						res,
						{ ok: false, output: error instanceof Error ? error.message : String(error) },
						500
					);
				}
			});
		}
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSources() {
	const files = walk(dataRoot)
		.filter((path) => yamlPattern.test(path))
		.map((path) => ({
			path: relative(catalogRoot, path),
			content: readFileSync(path, 'utf8')
		}));
	const nodeSources: Record<string, string[]> = {};
	for (const file of files) {
		indexNodeSources(file.path, file.content, nodeSources);
	}
	return { files, nodeSources };
}

function walk(dir: string): string[] {
	return readdirSync(dir)
		.flatMap((entry) => {
			const path = join(dir, entry);
			const stat = lstatSync(path);
			if (stat.isSymbolicLink()) throw new Error('Catalog data must not contain symbolic links');
			if (stat.isDirectory()) return walk(path);
			if (!stat.isFile()) throw new Error('Catalog data must contain only regular files');
			if (yamlPattern.test(path) && stat.size > MAX_SOURCE_FILE_BYTES) {
				throw new Error(`Catalog source exceeds ${MAX_SOURCE_FILE_BYTES} bytes`);
			}
			return [path];
		})
		.sort();
}

function indexNodeSources(path: string, content: string, nodeSources: Record<string, string[]>) {
	const fileOwned = fileOwnedNodeSource(path);
	if (fileOwned) {
		pushSource(nodeSources, `${fileOwned.type}:${fileOwned.id}`, path);
		return;
	}
	if (path === 'data/locations.yaml') {
		for (const match of content.matchAll(/^ {4}([a-z0-9][a-z0-9._:-]*):$/gm)) {
			pushSource(nodeSources, `location:${match[1]}`, path);
		}
		return;
	}
	const sectionTypes: Record<string, string> = {
		authors: 'author',
		groups: 'group',
		deployments: 'deployment',
		models: 'model',
		providers: 'provider',
		routes: 'route'
	};
	let section = '';
	for (const line of content.split('\n')) {
		const top = /^([a-z]+):$/.exec(line);
		if (top) section = top[1];
		const node = /^ {2}([a-z0-9][a-z0-9._:-]*):$/.exec(line);
		if (node && sectionTypes[section])
			pushSource(nodeSources, `${sectionTypes[section]}:${node[1]}`, path);
	}
}

function fileOwnedNodeSource(path: string) {
	if (!yamlPattern.test(path)) return null;
	const content = readFileSync(join(catalogRoot, path), 'utf8')
		.replace(/^\uFEFF/, '')
		.replace(/^---[ \t]*(?:\r?\n|$)/, '');
	const match = /^(authors|deployments|groups|models|providers|routes):\s*$/m.exec(content);
	if (!match) return null;
	const type = singularNodeType(match[1]);
	return { type, id: basename(path).replace(/\.ya?ml$/, '') };
}

function singularNodeType(type: string) {
	const types: Record<string, string> = {
		authors: 'author',
		groups: 'group',
		deployments: 'deployment',
		models: 'model',
		providers: 'provider',
		routes: 'route'
	};
	return types[type];
}

function pushSource(nodeSources: Record<string, string[]>, key: string, path: string) {
	const paths = nodeSources[key] ?? [];
	paths.push(path);
	nodeSources[key] = paths;
}

function safeCatalogPath(path: string) {
	try {
		const absolute = resolve(catalogRoot, path);
		const pathFromRoot = relative(dataRoot, absolute);
		if (
			!pathFromRoot ||
			pathFromRoot.startsWith(`..${sep}`) ||
			pathFromRoot === '..' ||
			resolve(dataRoot, pathFromRoot) !== absolute
		) {
			return null;
		}
		let cursor = dataRoot;
		for (const segment of pathFromRoot.split(sep)) {
			cursor = join(cursor, segment);
			const stats = lstatSync(cursor);
			if (stats.isSymbolicLink()) return null;
		}
		return lstatSync(absolute).isFile() ? absolute : null;
	} catch {
		return null;
	}
}

function readBody(req: import('node:http').IncomingMessage) {
	return new Promise<string>((resolveBody, reject) => {
		let body = '';
		let bytes = 0;
		let tooLarge = false;
		req.setEncoding('utf8');
		req.on('data', (chunk: string) => {
			if (tooLarge) return;
			bytes += Buffer.byteLength(chunk);
			if (bytes > MAX_SOURCE_BODY_BYTES) {
				body = '';
				tooLarge = true;
				return;
			}
			body += chunk;
		});
		req.on('end', () => {
			if (tooLarge) reject(new BodyTooLargeError());
			else resolveBody(body);
		});
		req.on('error', reject);
	});
}

class BodyTooLargeError extends Error {
	constructor() {
		super(`Catalog source request exceeds ${MAX_SOURCE_BODY_BYTES} bytes`);
	}
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

function sameOriginWriteRequest(req: import('node:http').IncomingMessage) {
	const origin = req.headers.origin;
	const host = req.headers.host;
	if (!origin || !host || req.headers['sec-fetch-site'] === 'cross-site') return false;
	try {
		const parsedOrigin = new URL(origin);
		if (req.headers['sec-fetch-site'] === 'same-origin') return true;
		const forwardedHost = req.headers['x-forwarded-host'];
		return (
			parsedOrigin.host === host ||
			(typeof forwardedHost === 'string' &&
				parsedOrigin.host === forwardedHost.split(',')[0]?.trim())
		);
	} catch {
		return false;
	}
}

function run(command: string[], cwd = catalogRoot) {
	return new Promise<string>((resolveRun, reject) => {
		const child = spawn(command[0], command.slice(1), { cwd, env: buildEnvironment() });
		let output = '';
		let outputBytes = 0;
		let settled = false;
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		const appendOutput = (chunk: string) => {
			if (settled) return;
			outputBytes += Buffer.byteLength(chunk);
			if (outputBytes > MAX_BUILD_OUTPUT_BYTES) {
				settled = true;
				child.kill('SIGKILL');
				reject(new Error(`Catalog build output exceeds ${MAX_BUILD_OUTPUT_BYTES} bytes`));
				return;
			}
			output += chunk;
		};
		child.stdout.on('data', appendOutput);
		child.stderr.on('data', appendOutput);
		child.on('error', (error) => {
			if (!settled) reject(error);
			settled = true;
		});
		child.on('close', (code) => {
			if (settled) return;
			settled = true;
			if (code === 0) resolveRun(output.trim());
			else reject(new Error(output.trim()));
		});
	});
}

function sendJson(res: import('node:http').ServerResponse, value: unknown, status = 200) {
	res.statusCode = status;
	res.setHeader('cache-control', 'no-store');
	res.setHeader('content-type', 'application/json');
	res.end(JSON.stringify(value));
}

function buildEnvironment() {
	const environment = { ...process.env };
	for (const name of Object.keys(environment)) {
		if (/(?:API_?KEY|CREDENTIAL|PASSWORD|PRIVATE_?KEY|SECRET|TOKEN)/i.test(name)) {
			delete environment[name];
		}
	}
	return environment;
}
