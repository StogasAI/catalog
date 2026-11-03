import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const root = fileURLToPath(new URL('../../', import.meta.url));
// Writes exercise the real editor API against a disposable catalog checkout.
const ownsCheckout = !process.env.CATALOG_BROWSER_CHECKOUT;
const checkout =
	process.env.CATALOG_BROWSER_CHECKOUT ?? mkdtempSync(join(tmpdir(), 'catalog-browser-'));
process.env.CATALOG_BROWSER_CHECKOUT = checkout;
if (ownsCheckout) {
	for (const directory of ['source', 'generated', 'editor']) {
		cpSync(join(root, directory), join(checkout, directory), {
			recursive: true,
			filter: (path) => !['node_modules', 'dist', 'test-results'].includes(basename(path))
		});
	}
	cpSync(join(root, 'package.json'), join(checkout, 'package.json'));
	symlinkSync(join(root, 'node_modules'), join(checkout, 'node_modules'), 'dir');
	const dependencies = join(root, 'editor/node_modules');
	const isolatedDependencies = join(checkout, 'editor/node_modules');
	mkdirSync(isolatedDependencies);
	for (const entry of readdirSync(dependencies)) {
		// Each Vite server owns its optimizer cache while packages remain shared.
		if (entry !== '.vite')
			symlinkSync(join(dependencies, entry), join(isolatedDependencies, entry));
	}
	process.once('exit', () => rmSync(checkout, { recursive: true, force: true }));
}

if (!process.env.CATALOG_BROWSER_ORIGIN) {
	const probe = createServer();
	await new Promise<void>((resolve, reject) => {
		probe.once('error', reject);
		probe.listen(0, '127.0.0.1', resolve);
	});
	const address = probe.address();
	if (!address || typeof address === 'string') throw new Error('No editor test port available');
	const port = address.port;
	await new Promise<void>((resolve, reject) =>
		probe.close((error) => (error ? reject(error) : resolve()))
	);
	process.env.CATALOG_BROWSER_ORIGIN = `http://127.0.0.1:${port}`;
}
const origin = process.env.CATALOG_BROWSER_ORIGIN;
const port = new URL(origin).port;

export default defineConfig({
	testDir: '.',
	testMatch: '*.spec.ts',
	workers: 1,
	forbidOnly: true,
	retries: 0,
	outputDir: `../../test-results/${basename(checkout)}`,
	projects: [
		{ name: 'chromium', use: devices['Desktop Chrome'] },
		{ name: 'firefox', use: devices['Desktop Firefox'] },
		{
			name: 'webkit',
			use: {
				...devices['Desktop Safari'],
				// Playwright's WebKit sometimes stops a page for good inside JavaScriptCore's parallel
				// garbage collection marking, on four cores as on GitHub's runners. One marker thread
				// made that about 18 times rarer in the verifier's tests, and no test needs more.
				// Replacing the environment keeps the rest of it.
				launchOptions: { env: { ...process.env, JSC_numberOfGCMarkers: '1' } }
			}
		}
	],
	use: {
		baseURL: origin,
		trace: 'off',
		screenshot: 'off',
		video: 'off'
	},
	webServer: {
		command: `bun run dev --port ${port}`,
		cwd: join(checkout, 'editor'),
		env: { VSCODE_PROXY_URI: '' },
		url: origin,
		timeout: 30_000
	}
});
