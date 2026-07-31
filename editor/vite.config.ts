import { spawn } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, type Plugin } from 'vite';

const editorRoot = dirname(fileURLToPath(import.meta.url));
const catalogRoot = resolve(editorRoot, '../source');
const dataRoot = join(catalogRoot, 'data');
const yamlPattern = /\.(ya?ml)$/;
const MAX_BUILD_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_BODY_BYTES = 2 * 1024 * 1024;

export default defineConfig({
	root: editorRoot,
	plugins: [catalogApi(), svelte()],
	server: {
		port: 5177,
		strictPort: false
	}
});

function catalogApi(): Plugin {
	return {
		name: 'stogas-catalog-api',
		configureServer(server) {
			server.middlewares.use('/api/catalog/sources', async (_req, res) => {
				try {
					sendJson(res, readSources());
				} catch (error) {
					sendJson(res, { error: errorMessage(error) }, 500);
				}
			});
			server.middlewares.use('/api/catalog/source', async (req, res) => {
				if (req.method !== 'PUT') {
					sendJson(res, { error: 'Method not allowed' }, 405);
					return;
				}
				let input: { path?: unknown; content?: unknown };
				try {
					input = JSON.parse(await readBody(req)) as typeof input;
				} catch (error) {
					sendJson(
						res,
						{ error: errorMessage(error) },
						error instanceof BodyTooLargeError ? 413 : 400
					);
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
				const absolute = safeCatalogPath(path);
				if (!absolute) {
					sendJson(res, { error: 'Path is not an existing catalog data file' }, 400);
					return;
				}
				writeFileSync(absolute, content);
				sendJson(res, { ok: true });
			});
			server.middlewares.use('/api/catalog/build', async (req, res) => {
				if (req.method !== 'POST') {
					sendJson(res, { error: 'Method not allowed' }, 405);
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
			if (stat.isSymbolicLink()) return [];
			return stat.isDirectory() ? walk(path) : [path];
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
	const match = /^(authors|deployments|models|providers|routes):\s*$/m.exec(content);
	if (!match) return null;
	const type = singularNodeType(match[1]);
	return { type, id: basename(path).replace(/\.ya?ml$/, '') };
}

function singularNodeType(type: string) {
	const types: Record<string, string> = {
		authors: 'author',
		deployments: 'deployment',
		models: 'model',
		providers: 'provider',
		routes: 'route'
	};
	return types[type];
}

function pushSource(nodeSources: Record<string, string[]>, key: string, path: string) {
	nodeSources[key] = [...(nodeSources[key] ?? []), path];
}

function safeCatalogPath(path: string) {
	try {
		const absolute = realpathSync(resolve(catalogRoot, path));
		const root = `${realpathSync(dataRoot)}${sep}`;
		return absolute.startsWith(root) && lstatSync(absolute).isFile() ? absolute : null;
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

function run(command: string[], cwd = catalogRoot) {
	return new Promise<string>((resolveRun, reject) => {
		const child = spawn(command[0], command.slice(1), { cwd });
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
	res.setHeader('content-type', 'application/json');
	res.end(JSON.stringify(value));
}
