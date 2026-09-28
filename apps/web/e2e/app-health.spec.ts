import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_HEALTH_LIVE_URL } from '../src/lib/app-health-public';

const tracker = readFileSync(join(__dirname, 'fixtures/app-health-tracker.txt'), 'utf8');

test('captures public navigation once, fixed actions, and excludes private transitions', async ({
  page,
}) => {
  const batches: Array<{ events: Array<{ type: string; path: string; name?: string }> }> = [];
  let loads = 0;
  await page.route('https://ingest.sassmaker.com/tracker.js', async (route) => {
    loads++;
    await route.fulfill({ contentType: 'application/javascript', body: tracker });
  });
  await page.route('https://ingest.sassmaker.com/v1/browser', async (route) => {
    batches.push(route.request().postDataJSON());
    await route.fulfill({ status: 202, body: '{}' });
  });
  await page.goto('/privacy?email=private@example.com');
  await expect(page.getByRole('heading', { name: 'Privacy', exact: true })).toBeVisible();
  await expect.poll(() => loads).toBe(1);
  await expect.poll(() => page.evaluate(() => 'appHealth' in window)).toBe(true);
  await expect.poll(() => batches.flatMap((b) => b.events).length).toBeGreaterThan(0);
  expect(loads).toBe(1);
  expect(batches.flatMap((b) => b.events).filter((e) => e.type === 'pageview')).toEqual([
    expect.objectContaining({ path: '/privacy' }),
  ]);
  await expect(page.getByRole('link', { name: 'Live analytics', exact: true })).toHaveAttribute(
    'href',
    APP_HEALTH_LIVE_URL
  );
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.href = 'https://example.com/source?token=private';
    link.textContent = 'Source';
    link.addEventListener('click', (event) => event.preventDefault());
    document.querySelector('main')?.append(link);
    link.click();
    history.pushState({}, '', '/privacy/reading?secret=private');
  });
  await expect
    .poll(() => batches.flatMap((b) => b.events).some((e) => e.name === 'source.opened'))
    .toBe(true);
  await expect
    .poll(() => batches.flatMap((b) => b.events).some((e) => e.path === '/privacy/reading'))
    .toBe(true);
  await page.evaluate(() => history.pushState({}, '', '/review/private?token=private'));
  await expect.poll(() => page.evaluate(() => 'appHealth' in window)).toBe(false);
  expect(JSON.stringify(batches)).not.toContain('private');
  expect(batches.flatMap((b) => b.events).some((e) => e.path.startsWith('/review'))).toBe(false);
});

test('acknowledges the primary signals CTA before in-app navigation', async ({ page }) => {
  const batches: Array<{ events: Array<{ type: string; path: string; name?: string }> }> = [];
  await page.route('https://ingest.sassmaker.com/tracker.js', async (route) => {
    await route.fulfill({ contentType: 'application/javascript', body: tracker });
  });
  await page.route('https://ingest.sassmaker.com/v1/browser', async (route) => {
    batches.push(route.request().postDataJSON());
    await route.fulfill({ status: 202, body: '{}' });
  });

  await page.goto('/');
  const browse = page.getByRole('link', { name: 'browse earlier verified signals', exact: true });
  await expect(browse).toBeVisible();
  await browse.click();

  await expect(page).toHaveURL(/\/signals$/);
  await expect
    .poll(() =>
      batches
        .flatMap((batch) => batch.events)
        .some((event) => event.name === 'signals.browse_opened')
    )
    .toBe(true);
  expect(batches.flatMap((batch) => batch.events)).toContainEqual(
    expect.objectContaining({ type: 'event', name: 'signals.browse_opened', path: '/' })
  );
});

test('analytics delivery failure leaves the page usable', async ({ page }) => {
  await page.route('https://ingest.sassmaker.com/**', (route) => route.abort());
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: 'Privacy', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Live analytics', exact: true })).toBeVisible();
});

test('declared crawler does not enter reader analytics', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ userAgent: 'Googlebot/2.1' });
  const page = await context.newPage();
  let loads = 0;
  await page.route('https://ingest.sassmaker.com/**', async (route) => {
    loads++;
    await route.abort();
  });
  await page.goto(`${baseURL}/privacy`);
  await expect(page.getByRole('heading', { name: 'Privacy', exact: true })).toBeVisible();
  await page.waitForTimeout(2000);
  expect(loads).toBe(0);
  await context.close();
});
