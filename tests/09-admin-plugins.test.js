/**
 * Admin UI Plugin & Security Tests
 *
 * Tests plugin management and security settings in Admin UI
 */

const { ContainerManager } = require('../lib/container-manager');
const { LogMonitor } = require('../lib/log-monitor');
const { AdminUiTester } = require('../lib/admin-ui-tester');

describe('Admin UI - Plugins & Security', () => {
  let manager;
  let logMonitor;
  let uiTester;

  beforeAll(async () => {
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
    await uiTester.close();
    await manager.remove(true);
  });

  describe('Plugin Management', () => {
    test('plugin management page loads without errors', async () => {
      logMonitor.setPhase('ui-plugins');

      const results = await uiTester.testPluginManagement();

      expect(results.failed).toHaveLength(0);
      expect(logMonitor.getPhaseErrors('ui-plugins')).toHaveLength(0);
    });
  });

  describe('Security Settings', () => {
    test('security settings page loads without errors', async () => {
      logMonitor.setPhase('ui-security');

      const results = await uiTester.testSecuritySettings();

      expect(results.failed).toHaveLength(0);
      expect(logMonitor.getPhaseErrors('ui-security')).toHaveLength(0);
    });
  });

  describe('Server Configuration', () => {
    test('server configuration page loads without errors', async () => {
      logMonitor.setPhase('ui-config');

      const results = await uiTester.testServerConfiguration();

      expect(results.failed).toHaveLength(0);
      expect(logMonitor.getPhaseErrors('ui-config')).toHaveLength(0);
    });
  });

  describe('Connection Management', () => {
    test('connection management page loads without errors', async () => {
      logMonitor.setPhase('ui-connections');

      const results = await uiTester.testConnectionManagement();

      expect(results.failed).toHaveLength(0);
      expect(logMonitor.getPhaseErrors('ui-connections')).toHaveLength(0);
    });
  });
});
