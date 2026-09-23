import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui',
  timeout: 30000,
  fullyParallel: true,
  workers: 2,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:8765', locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node tests/ui/server.mjs', url: 'http://127.0.0.1:8765', reuseExistingServer: false },
  projects: [
    { name: 'iphone-webkit', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], browserName: 'chromium' } },
  ],
});
