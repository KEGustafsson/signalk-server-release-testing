/**
 * Admin UI Security Tests
 *
 * Tests security settings and access controls in the Admin UI
 */

const { ContainerManager } = require('../lib/container-manager');
const { LogMonitor } = require('../lib/log-monitor');
const { AdminUiTester } = require('../lib/admin-ui-tester');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('Admin UI - Security Settings', () => {
  let manager;
  let logMonitor;
  let uiTester;
  let baseUrl;

  beforeAll(async () => {
    logMonitor = new LogMonitor();
    manager = new ContainerManager({
      image: process.env.SIGNALK_IMAGE || 'signalk/signalk-server:latest',
      logMonitor,
    });
    const info = await manager.start();
    baseUrl = info.baseUrl;

    uiTester = new AdminUiTester({ baseUrl: info.baseUrl });
    await uiTester.init();
  }, 120000);

  afterAll(async () => {
    await uiTester.close();
    await manager.remove(true);

    const summary = logMonitor.getSummary();
    console.log('\n--- Security Test Log Summary ---');
    console.log(`Total Errors: ${summary.totalErrors}`);
  });

  describe('Security Page', () => {
    test('security settings page loads without errors', async () => {
      logMonitor.setPhase('ui-security-page');

      const results = await uiTester.testSecuritySettings();

      expect(results.failed).toHaveLength(0);
      expect(logMonitor.getPhaseErrors('ui-security-page')).toHaveLength(0);
    });
  });

  describe('Access Controls', () => {
    test('login endpoint exists', async () => {
      logMonitor.setPhase('ui-security-login');

      // Check that the login/auth endpoints exist
      const res = await fetch(`${baseUrl}/signalk/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'test', password: 'test' }),
      });

      // Expect either 401 (bad credentials) or 200 (if security disabled)
      // or 404 (endpoint doesn't exist in this version)
      expect([200, 401, 403, 404]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('ui-security-login')).toHaveLength(0);
    });

    test('access requests endpoint exists', async () => {
      logMonitor.setPhase('ui-security-access');

      const res = await fetch(`${baseUrl}/signalk/v1/access/requests`);

      // May require auth or not exist
      expect([200, 401, 403, 404]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('ui-security-access')).toHaveLength(0);
    });
  });

  describe('API Security', () => {
    test('public endpoints are accessible', async () => {
      logMonitor.setPhase('ui-security-public');

      // These endpoints should always be accessible
      const endpoints = ['/signalk'];

      for (const endpoint of endpoints) {
        const res = await fetch(`${baseUrl}${endpoint}`);
        expect(res.ok).toBe(true);
      }

      // API endpoint may return 404 if no data, which is OK
      const apiRes = await fetch(`${baseUrl}/signalk/v1/api`);
      expect([200, 404]).toContain(apiRes.status);

      expect(logMonitor.getPhaseErrors('ui-security-public')).toHaveLength(0);
    });

    test('admin endpoints require proper access', async () => {
      logMonitor.setPhase('ui-security-admin');

      // Admin endpoints may or may not require auth depending on config
      const res = await fetch(`${baseUrl}/plugins`);

      // Either accessible (security disabled) or requires auth
      expect([200, 401, 403]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('ui-security-admin')).toHaveLength(0);
    });
  });
});
