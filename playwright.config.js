const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './e2e',
  timeout: 60000,
  use: { baseURL: 'http://localhost:3100' },
  webServer: {
    command: 'node server/index.js',
    url: 'http://localhost:3100',
    reuseExistingServer: true,
    env: { PORT: '3100', DB_PATH: './e2e.db', JWT_SECRET: 'e2e-secret' }
  }
});
