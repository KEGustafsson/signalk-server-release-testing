/**
 * Jest test setup
 *
 * Global setup and utilities for all tests
 */

const { LogMonitor } = require('../lib/log-monitor');
const { ContainerManager } = require('../lib/container-manager');
const Docker = require('dockerode');

// Increase default timeout for Docker operations
jest.setTimeout(120000);

// Global test state
global.testState = {
  logMonitor: null,
  containerManager: null,
  connectionInfo: null,
};

// Pull Docker image once before all tests
const pullImage = async (imageName) => {
  const docker = new Docker();
  console.log(`Pulling image: ${imageName}...`);

  return new Promise((resolve, reject) => {
    docker.pull(imageName, (err, stream) => {
      if (err) {
        // Image might already exist locally
        console.log(`Image pull skipped: ${err.message}`);
        return resolve();
      }

      docker.modem.followProgress(stream, (err, output) => {
        if (err) {
          console.log(`Image pull warning: ${err.message}`);
          return resolve();
        }
        console.log(`Image ready: ${imageName}`);
        resolve();
      });
    });
  });
};

// Setup before all tests
beforeAll(async () => {
  const image = process.env.SIGNALK_IMAGE || 'signalk/signalk-server:latest';

  console.log('='.repeat(60));
  console.log('SignalK Release Validation Suite');
  console.log(`Image: ${image}`);
  console.log(`Date: ${new Date().toISOString()}`);
  console.log('='.repeat(60));

  // Pull image once at the start
  await pullImage(image);
}, 300000); // 5 minute timeout for image pull

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
