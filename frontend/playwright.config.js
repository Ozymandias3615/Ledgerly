const { defineConfig, devices } = require("@playwright/test");

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}`;
// Points the app at a locally-running backend, never the production API in
// frontend/.env - E2E runs create real accounts/data and must never land
// there.
const BACKEND_URL = process.env.E2E_BACKEND_URL || "http://localhost:8000";

module.exports = defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm start",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      BROWSER: "none",
      REACT_APP_BACKEND_URL: BACKEND_URL,
    },
  },
});
