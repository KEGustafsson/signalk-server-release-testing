/**
 * Jest Global Teardown
 *
 * Cleans up shared container after all test suites complete.
 */

const { destroySharedContainer } = require('./shared-container');

module.exports = async () => {
  console.log('\n[GlobalTeardown] Cleaning up shared container...');
  await destroySharedContainer();
  console.log('[GlobalTeardown] Cleanup complete');
};
