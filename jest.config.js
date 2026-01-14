module.exports = {
  testEnvironment: 'node',
  testTimeout: 120000,
  verbose: true,
  forceExit: true,
  detectOpenHandles: true,
  testMatch: ['**/tests/**/*.test.js'],
  setupFilesAfterEnv: ['./tests/setup.js'],
  reporters: [
    'default',
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
