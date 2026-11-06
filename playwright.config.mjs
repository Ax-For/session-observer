import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: { baseURL: "http://127.0.0.1:8878", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop-1280", use: { viewport: { width: 1280, height: 900 } } },
    { name: "desktop-1440", use: { viewport: { width: 1440, height: 1000 } } },
  ],
  webServer: { command: "node --max-old-space-size=64 --max-semi-space-size=4 tests/support/e2e-server.cjs", url: "http://127.0.0.1:8878", reuseExistingServer: false, timeout: 30000 },
});
