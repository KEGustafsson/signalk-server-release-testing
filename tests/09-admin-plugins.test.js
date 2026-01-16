/**
 * Admin UI Plugin & Security Tests
 *
 * Tests plugin management and security settings in Admin UI.
 * Skips if Playwright browsers are not installed.
 */

const { ContainerManager } = require('../lib/container-manager');
const { LogMonitor } = require('../lib/log-monitor');
const { AdminUiTester } = require('../lib/admin-ui-tester');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Check if browsers are available before running tests
let browserAvailable = false;
let browserCheckDone = false;

beforeAll(async () => {
  if (!browserCheckDone) {
    browserAvailable = await AdminUiTester.isBrowserAvailable();
    browserCheckDone = true;
    if (!browserAvailable) {
      console.log('Playwright browsers not installed - skipping Admin UI tests');
    }
  }
});

describe('Admin UI - Plugins & Security', () => {
  let manager;
  let logMonitor;
  let uiTester;

  beforeAll(async () => {
    if (!browserAvailable) return;

    logMonitor = new LogMonitor();
    manager = new ContainerManager({
      image: process.env.SIGNALK_IMAGE || 'signalk/signalk-server:latest',
      logMonitor,
    });
    const info = await manager.start();

    uiTester = new AdminUiTester({ baseUrl: info.baseUrl });
    await uiTester.init();

    await sleep(3000);
  }, 120000);

  afterAll(async () => {
    if (!browserAvailable) return;

    if (uiTester) await uiTester.close();
    if (manager) await manager.remove(true);
  });

  describe('Plugin Management', () => {
    test('plugin management page loads without errors', async () => {
      if (!browserAvailable) {
        console.log('Skipped: Playwright browsers not installed');
        return;
      }

      logMonitor.setPhase('ui-plugins');

      const results = await uiTester.testPluginManagement();

      expect(results.failed).toHaveLength(0);
      expect(logMonitor.getPhaseErrors('ui-plugins')).toHaveLength(0);
    });
  });

  describe('Security Settings', () => {
    test('security settings page loads without errors', async () => {
      if (!browserAvailable) {
        console.log('Skipped: Playwright browsers not installed');
        return;
      }

      logMonitor.setPhase('ui-security');

      const results = await uiTester.testSecuritySettings();

      expect(results.failed).toHaveLength(0);
      expect(logMonitor.getPhaseErrors('ui-security')).toHaveLength(0);
    });
  });

  describe('Server Configuration', () => {
    test('server configuration page loads without errors', async () => {
      if (!browserAvailable) {
        console.log('Skipped: Playwright browsers not installed');
        return;
      }

      logMonitor.setPhase('ui-config');

      const results = await uiTester.testServerConfiguration();

      expect(results.failed).toHaveLength(0);
      expect(logMonitor.getPhaseErrors('ui-config')).toHaveLength(0);
    });
  });

  describe('Connection Management', () => {
    test('connection management page loads without errors', async () => {
      if (!browserAvailable) {
        console.log('Skipped: Playwright browsers not installed');
        return;
      }

      logMonitor.setPhase('ui-connections');

      const results = await uiTester.testConnectionManagement();

      expect(results.failed).toHaveLength(0);
      expect(logMonitor.getPhaseErrors('ui-connections')).toHaveLength(0);
    });
  });
});
