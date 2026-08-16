const { test, expect } = require("@playwright/test");

function uniqueEmail() {
  return `e2e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

test("login, create a transaction, and create an invoice", async ({ page }) => {
  const email = uniqueEmail();
  const password = "SmokeTest123!";

  // Register (auto-logs in), then finish onboarding. Registration now opens
  // on a Business/Personal chooser before the form itself - pick Business to
  // exercise the same flow this suite always has.
  await page.goto("/register");
  await page.getByTestId("choose-business-button").click();
  await page.getByTestId("register-name-input").fill("Smoke Test");
  await page.getByTestId("register-email-input").fill(email);
  await page.getByTestId("register-password-input").fill(password);
  await page.getByTestId("register-submit-button").click();

  await page.waitForURL("**/onboarding");
  await page.getByTestId("onboarding-skip-button").click();
  await page.waitForURL("**/dashboard");

  // Log out, then log back in through the real login form - the flow this
  // suite is meant to cover, not just an authenticated session left over
  // from registration.
  await page.getByTestId("logout-button").click();
  await page.waitForURL("**/login");
  await page.getByTestId("login-email-input").fill(email);
  await page.getByTestId("login-password-input").fill(password);
  await page.getByTestId("login-submit-button").click();
  await page.waitForURL("**/dashboard");

  // Create a transaction.
  await page.getByTestId("nav-transactions").click();
  await page.waitForURL("**/transactions");
  await page.getByTestId("add-transaction-button").click();
  await page.getByTestId("tx-amount-input").fill("123.45");
  await page.getByTestId("tx-submit-button").click();
  await expect(page.locator('[data-testid^="tx-row-"]').first()).toContainText("123.45");

  // Create an invoice.
  await page.getByTestId("nav-invoices").click();
  await page.waitForURL("**/invoices");
  await page.getByTestId("new-invoice-button").click();
  await page.getByTestId("inv-client-name-input").fill("Acme Co");
  await page.getByTestId("inv-item-desc-0").fill("Consulting");
  await page.getByTestId("inv-submit-button").click();
  await expect(page.locator('[data-testid^="inv-row-"]').first()).toContainText("Acme Co");
});
