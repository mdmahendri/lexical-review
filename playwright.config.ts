import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:5173/lexical-review/";

export default defineConfig({
  testDir: "./e2e",
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
  ],
  webServer: {
    command: "pnpm --filter demo dev --host 127.0.0.1",
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
