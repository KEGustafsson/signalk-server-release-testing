/**
 * Shared Container Manager
 *
 * Provides a single container instance that can be shared across multiple test files.
 * This dramatically reduces test execution time by avoiding container startup/teardown
 * for each test file.
 */

const { ContainerManager } = require('../lib/container-manager');
const { LogMonitor } = require('../lib/log-monitor');
const { NmeaFeeder } = require('../lib/nmea-feeder');

// Singleton instance
let sharedInstance = null;

class SharedContainer {
  constructor() {
    this.manager = null;
    this.logMonitor = null;
    this.feeder = null;
    this.connectionInfo = null;
    this.refCount = 0;
    this.initialized = false;
    this.initPromise = null;
  }

  /**
   * Get or create the shared container instance.
   * Multiple test files can call this - the container is only created once.
   */
  async acquire() {
    this.refCount++;

    if (this.initialized) {
      return this.getInfo();
    }

    // If initialization is in progress, wait for it
    if (this.initPromise) {
      await this.initPromise;
      return this.getInfo();
    }

    // Start initialization
    this.initPromise = this._initialize();
    await this.initPromise;
    return this.getInfo();
  }

  async _initialize() {
    console.log('[SharedContainer] Initializing shared container...');

    this.logMonitor = new LogMonitor();
    this.manager = new ContainerManager({
      image: process.env.SIGNALK_IMAGE || 'signalk/signalk-server:latest',
      logMonitor: this.logMonitor,
      containerName: 'signalk-shared-test-' + Date.now(),
    });

    this.connectionInfo = await this.manager.start();
    this.feeder = new NmeaFeeder({ tcpPort: this.connectionInfo.tcpPort });

    // Wait a bit for provider initialization
    await new Promise(r => setTimeout(r, 2000));

    this.initialized = true;
    console.log('[SharedContainer] Container ready');
  }

  /**
   * Release a reference to the shared container.
   * Container is only removed when all references are released.
   */
  async release() {
    this.refCount--;

    if (this.refCount <= 0 && this.initialized) {
      await this.destroy();
    }
  }

  /**
   * Force destroy the container (used in globalTeardown)
   */
  async destroy() {
    if (this.manager) {
      console.log('[SharedContainer] Destroying shared container...');
      const summary = this.logMonitor?.getSummary();
      if (summary) {
        console.log(`[SharedContainer] Total Errors: ${summary.totalErrors}`);
        console.log(`[SharedContainer] Total Warnings: ${summary.totalWarnings}`);
      }
      await this.manager.remove(true);
      this.manager = null;
      this.initialized = false;
      this.initPromise = null;
    }
  }

  getInfo() {
    return {
      manager: this.manager,
      logMonitor: this.logMonitor,
      feeder: this.feeder,
      ...this.connectionInfo,
    };
  }

  /**
   * Reset log monitor phase for a new test file
   */
  resetPhase(phaseName) {
    this.logMonitor?.setPhase(phaseName);
  }
}

// Export singleton getter
function getSharedContainer() {
  if (!sharedInstance) {
    sharedInstance = new SharedContainer();
  }
  return sharedInstance;
}

// For global teardown
async function destroySharedContainer() {
  if (sharedInstance) {
    await sharedInstance.destroy();
    sharedInstance = null;
  }
}

module.exports = {
  getSharedContainer,
  destroySharedContainer,
  SharedContainer,
};
