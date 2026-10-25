import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:5178",
    headless: true,
    channel:
      process.env.PLAYWRIGHT_CHANNEL === "chromium"
        ? undefined
        : (process.env.PLAYWRIGHT_CHANNEL ?? "chrome"),
    viewport: { width: 1440, height: 1100 },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chrome-1x", use: { deviceScaleFactor: 1 } },
    { name: "chrome-2x", use: { deviceScaleFactor: 2 } },
  ],
  webServer: {
    command:
      "npm run dev -- --host 127.0.0.1 --port 5178 --strictPort --mode e2e",
    url: "http://127.0.0.1:5178",
    reuseExistingServer: false,
    env: {
      VITE_FIREBASE_API_KEY: "",
      VITE_FIREBASE_PROJECT_ID: "",
      VITE_FIREBASE_APP_ID: "",
    },
  },
});
