// Default config - runs all individual tests
const baseConfig = {
  testEnvironment: 'node',
  testTimeout: 120000,
  verbose: false,
  forceExit: true,
  detectOpenHandles: false,
  setupFilesAfterEnv: ['./tests/setup.js'],
  reporters: [
    [
      './lib/custom-reporter.js',
      {
        outputDir: './reports',
      },
    ],
  ],
  globals: {
    SIGNALK_IMAGE: process.env.SIGNALK_IMAGE || 'signalk/signalk-server:latest',
  },
};

// Check for fast mode via env var
const isFastMode = process.env.FAST_TESTS === 'true';

module.exports = {
  ...baseConfig,
  // In fast mode: run combined tests only
  // In normal mode: run individual tests (excluding combined to avoid duplicates)
  testMatch: isFastMode
    ? ['**/tests/core-api.test.js', '**/tests/01-server-lifecycle.test.js', '**/tests/02-plugin-loading.test.js']
    : ['**/tests/[0-9]*.test.js'],
  globalTeardown: isFastMode ? './tests/globalTeardown.js' : undefined,
};
