import { test, expect } from "@playwright/test";

const PRODUCTS = [
  "brief",
  "track record",
  "markets",
  "communities",
  "mentions",
  "agent eval",
  "lab",
];

test("primary nav shows all product groups", async ({ page }) => {
  await page.goto("/");
  for (const label of PRODUCTS) {
    await expect(
      page.getByRole("button", { name: new RegExp(`^${label}`, "i") }),
    ).toBeVisible();
  }
});

test("expanding a product reveals its sub-features", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^markets/i }).click();
  const menu = page.getByRole("menu", { name: "markets" });
  await expect(menu).toBeVisible();
  for (const href of ["/signals", "/entities", "/sectors", "/watchlist/entities", "/backtest-workbench"]) {
    await expect(menu.locator(`a[href="${href}"]`)).toBeVisible();
  }
  // Wait for the open transition to settle so the panel is fully opaque.
  await expect
    .poll(async () => Number(await menu.evaluate((el) => getComputedStyle(el).opacity)))
    .toBeGreaterThan(0.99);
  await page.screenshot({ path: "test-results/nav-markets-open.png" });
});
