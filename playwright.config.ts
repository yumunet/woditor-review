import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', timeout: 120_000, workers: 1,
  use: {baseURL: 'http://127.0.0.1:4173', channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined), trace: 'retain-on-failure'},
  webServer: {command: 'npm run preview', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI, timeout: 30_000},
  projects: [{name: 'mobile', use: {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true}}, {name: 'desktop', use: {viewport: {width: 1280, height: 900}}}],
});
