import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('graph selection and resizing work with a keyboard; both themes reflow', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto('/');
	const node = page.locator('.node-card').first();
	await expect(node).toBeVisible();
	const key = await node.evaluate((element) =>
		element.closest('.svelte-flow__node')!.getAttribute('data-id')!
	);
	await node.focus();
	await node.press('Enter');
	await expect(page.getByRole('combobox', { name: 'Node on this page' })).toHaveValue(key);
	await expect(page.locator('.inspector h2')).toHaveText(key.slice(key.indexOf(':') + 1));
	await expect(node).toHaveAttribute('aria-pressed', 'true');
	const splitter = page.getByRole('separator', { name: 'Resize details panel' });
	await splitter.focus();
	await splitter.press('Home');
	await expect(splitter).toHaveAttribute('aria-valuenow', '360');
	await splitter.press('ArrowLeft');
	await expect
		.poll(async () => Number(await splitter.getAttribute('aria-valuenow')))
		.toBeGreaterThan(360);
	for (const width of [1440, 320]) {
		await page.setViewportSize({ width, height: 900 });
		for (const theme of ['Light', 'Dark']) {
			await page.getByRole('button', { name: theme, exact: true }).click();
			await expect
				.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
				.toBe(0);
			const audit = await new AxeBuilder({ page })
				.withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
				.analyze();
			expect(audit.violations).toEqual([]);
		}
	}
});

test.describe('touch editing', () => {
	test.use({ hasTouch: true, viewport: { width: 320, height: 844 } });

	test('drafts survive selection and a late save, then persist through the real source API', async ({
		page
	}) => {
		await page.goto('/');
		const picker = page.getByRole('combobox', { name: 'Node on this page' });
		await picker.selectOption('author:anthropic');
		const editor = page.getByRole('textbox', { name: 'Raw catalog source' });
		await expect(editor).not.toHaveValue('');
		await expect(editor).toHaveCSS('font-size', '16px');
		const original = await editor.inputValue();
		const submitted = `${original.trimEnd()}\n# Browser save regression\n`;
		const newer = `${submitted}# Additional unsaved edit\n`;
		await editor.fill(submitted);
		await picker.selectOption('provider:anthropic');
		await expect(editor).not.toHaveValue(submitted);
		await picker.selectOption('author:anthropic');
		await expect(editor).toHaveValue(submitted);
		let release!: () => void;
		const held = new Promise<void>((resolve) => (release = resolve));
		let saved!: () => void;
		const received = new Promise<void>((resolve) => (saved = resolve));
		await page.route(
			'**/api/catalog/source',
			async (route) => {
				const response = await route.fetch();
				saved();
				await held;
				await route.fulfill({ response });
			},
			{ times: 1 }
		);
		try {
			await page.getByRole('button', { name: 'Save', exact: true }).click();
			await received;
			// Reverting to the old baseline is still a newer edit than the pending save.
			await editor.fill(original);
			release();
			await expect(editor).toHaveValue(original);
			await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
			const save = page.getByRole('button', { name: 'Save', exact: true });
			await expect(save).toBeEnabled();
			await editor.fill(newer);
			await save.click();
			await expect(page.getByText('Saved', { exact: true })).toBeVisible();
			await page.reload();
			await picker.selectOption('author:anthropic');
			await expect(editor).toHaveValue(newer);
			await expect(save).toBeDisabled();
		} finally {
			release();
		}
	});
});
