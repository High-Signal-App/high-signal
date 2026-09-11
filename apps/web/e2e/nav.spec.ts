import { test, expect } from '@playwright/test';

const DESTINATIONS = [
  { label: 'brief', href: '/' },
  { label: 'signals', href: '/signals' },
  { label: 'sources', href: '/data' },
  { label: 'track record', href: '/track-record' },
];

test('primary navigation exposes the four reader destinations', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Primary', exact: true });
  for (const { label, href } of DESTINATIONS) {
    await expect(nav.getByRole('link', { name: label, exact: true })).toHaveAttribute('href', href);
  }
  await expect(nav.getByRole('link', { name: 'brief', exact: true })).toHaveAttribute(
    'aria-current',
    'page'
  );
});

test('navigation acknowledges a click before a slow destination responds', async ({ page }) => {
  await page.goto('/');
  let releaseNavigation = () => {};
  const navigationGate = new Promise<void>((resolve) => {
    releaseNavigation = resolve;
  });
  let interceptedNavigation = false;
  await page.route('**/signals?*', async (route) => {
    if (route.request().headers()['rsc'] === '1') {
      interceptedNavigation = true;
      await navigationGate;
    }
    await route.continue();
  });

  const nav = page.getByRole('navigation', { name: 'Primary', exact: true });
  const signals = nav.getByRole('link', { name: 'signals', exact: true });
  try {
    await signals.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => interceptedNavigation).toBe(true);
    await expect(signals.getByRole('status')).toHaveText('Loading signals…');
    await expect(page.getByRole('heading', { name: 'Signals', exact: true })).toHaveCount(0);
  } finally {
    releaseNavigation();
  }

  await expect(page).toHaveURL('/signals');
  await expect(page.getByRole('heading', { name: 'Signals', exact: true })).toBeVisible();
  await expect(signals).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('status')).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL('/');
  await expect(nav.getByRole('link', { name: 'brief', exact: true })).toHaveAttribute(
    'aria-current',
    'page'
  );
});
