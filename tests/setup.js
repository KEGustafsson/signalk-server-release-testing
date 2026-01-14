/**
 * Jest test setup
 *
 * Global setup and utilities for all tests
 */

const { LogMonitor } = require('../lib/log-monitor');
const { ContainerManager } = require('../lib/container-manager');

// Increase default timeout for Docker operations
jest.setTimeout(120000);

// Global test state
global.testState = {
  logMonitor: null,
  containerManager: null,
  connectionInfo: null,
};

// Setup before all tests
beforeAll(async () => {
  console.log('='.repeat(60));
  console.log('SignalK Release Validation Suite');
  console.log(`Image: ${process.env.SIGNALK_IMAGE || 'signalk/signalk-server:latest'}`);
  console.log(`Date: ${new Date().toISOString()}`);
  console.log('='.repeat(60));
});

// Cleanup after all tests
afterAll(async () => {
  // Cleanup is handled by individual test files
});

// Custom matchers
expect.extend({
  toHaveNoErrors(logMonitor) {
    const errors = logMonitor.errors;
    const pass = errors.length === 0;

    return {
      pass,
      message: () =>
        pass
          ? 'Expected log monitor to have errors but found none'
          : `Expected no errors but found ${errors.length}:\n${errors
              .slice(0, 5)
              .map((e) => `  - ${e.line}`)
              .join('\n')}`,
    };
  },

  toHaveNoCriticalErrors(logMonitor) {
    const criticalErrors = logMonitor.errors.filter(
      (e) =>
        /fatal|crash|segfault|uncaught|unhandled/i.test(e.line)
    );
    const pass = criticalErrors.length === 0;

    return {
      pass,
      message: () =>
        pass
          ? 'Expected log monitor to have critical errors but found none'
          : `Expected no critical errors but found ${criticalErrors.length}:\n${criticalErrors
              .slice(0, 5)
              .map((e) => `  - ${e.line}`)
              .join('\n')}`,
    };
  },
});

// Utility functions
global.waitFor = async (conditionFn, timeout = 30000, interval = 1000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await conditionFn()) {
      return true;
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`Condition not met within ${timeout}ms`);
};

global.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
