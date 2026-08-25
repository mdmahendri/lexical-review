import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:5174/";

export default defineConfig({
  testDir: "./packages/demo/e2e",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], browserName: "chromium" },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"], browserName: "firefox" },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"], browserName: "webkit" },
    },
  ],
  webServer: {
    cwd: "packages/demo",
    command:
      "pnpm exec vite --config e2e/vite.config.js --host 127.0.0.1 --port 5174 --strictPort",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
