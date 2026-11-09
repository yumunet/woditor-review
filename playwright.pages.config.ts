import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir: './tests/pages', timeout: 120000, workers: 1,
  use: {baseURL: 'http://127.0.0.1:4173/woditor-review/', channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined), trace: 'retain-on-failure'},
  webServer: {command: 'npm run preview', url: 'http://127.0.0.1:4173/woditor-review/', env: {BASE_PATH: '/woditor-review/'}, timeout: 30000},
  projects: [{name: 'mobile', use: {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true}}, {name: 'desktop', use: {viewport: {width: 1280, height: 900}}}],
});
