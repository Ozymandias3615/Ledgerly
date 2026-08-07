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
      // frontend/.env is gitignored and won't exist in CI - without these
      // the app throws on Firebase init and white-screens (same gotcha
      // documented in .github/workflows/build-windows.yml). These are
      // client-side values (meant to be public), safe to set here directly.
      REACT_APP_FIREBASE_API_KEY: "AIzaSyCxKinW70GNB41emSDgvdtqQPXkppgcO7I",
      REACT_APP_FIREBASE_AUTH_DOMAIN: "ledgerly-98458.firebaseapp.com",
      REACT_APP_FIREBASE_PROJECT_ID: "ledgerly-98458",
      REACT_APP_FIREBASE_APP_ID: "1:129649921204:web:e06edaaddcf550c5465be1",
      REACT_APP_GOOGLE_CLIENT_ID: "129649921204-uu2ol3vak73mltqd3t4sdnsf095tir5k.apps.googleusercontent.com",
    },
  },
});
