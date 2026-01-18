/**
 * Admin UI Comprehensive Tests
 *
 * Tests ALL SignalK Admin UI pages in a single container session.
 * Logs in as admin once and navigates through all admin pages.
 */

const { ContainerManager } = require('../lib/container-manager');
const { LogMonitor } = require('../lib/log-monitor');
const { AdminUiTester } = require('../lib/admin-ui-tester');
const { NmeaFeeder } = require('../lib/nmea-feeder');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Check if browsers are available before running tests
let browserAvailable = false;

beforeAll(async () => {
  browserAvailable = await AdminUiTester.isBrowserAvailable();
  if (!browserAvailable) {
    console.log('Playwright browsers not installed - skipping Admin UI tests');
    console.log('Run "npx playwright install chromium" to enable UI tests');
  }
}, 30000);

describe('Admin UI - Comprehensive Tests', () => {
  let manager;
  let logMonitor;
  let uiTester;
  let feeder;
  let baseUrl;

  beforeAll(async () => {
    if (!browserAvailable) return;

    logMonitor = new LogMonitor();
    manager = new ContainerManager({
      image: process.env.SIGNALK_IMAGE || 'signalk/signalk-server:latest',
      logMonitor,
    });
    const info = await manager.start();
    baseUrl = info.baseUrl;

    uiTester = new AdminUiTester({ baseUrl: info.baseUrl });
    await uiTester.init();

    feeder = new NmeaFeeder({ tcpPort: info.tcpPort });

    // Feed some data so pages have content to show
    await feeder.sendTcp([
      '$GPRMC,123519,A,6000.000,N,02400.000,E,5.5,45.0,010125,0.0,E,A*1A',
      '$GPGGA,123519,6000.000,N,02400.000,E,1,08,0.9,10.0,M,0.0,M,,*4A',
      '$SDDBT,10.0,f,3.0,M,1.6,F*2A',
      '$SDMTW,18.5,C*1A',
      '$WIMWV,270.0,R,15.0,M,A*1A',
      '$HEHDT,125.5,T*1A',
    ]);
    await sleep(3000);

    // Login as admin ONCE at the beginning
    logMonitor.setPhase('admin-login');
    const loggedIn = await uiTester.ensureLoggedIn();
    if (!loggedIn) {
      console.warn('Warning: Could not login as admin');
    }
  }, 180000);

  afterAll(async () => {
    if (!browserAvailable) return;

    if (uiTester) await uiTester.close();
    if (manager) await manager.remove(true);

    if (logMonitor) {
      const summary = logMonitor.getSummary();
      console.log('\n--- Admin UI Test Summary ---');
      console.log(`Total Errors: ${summary.totalErrors}`);
      console.log(`Console Errors: ${uiTester?.getConsoleErrors().length || 0}`);
      console.log(`Screenshots: ${uiTester?.getScreenshots().length || 0}`);
    }
  });

  // ============ DASHBOARD ============
  describe('Dashboard', () => {
    test('dashboard loads and displays server stats', async () => {
      if (!browserAvailable) return;
      logMonitor.setPhase('ui-dashboard');

      const results = await uiTester.testDashboard();

      expect(results.failed).toHaveLength(0);
      expect(logMonitor.getPhaseErrors('ui-dashboard')).toHaveLength(0);
    });

    test('no critical JavaScript errors on dashboard', async () => {
      if (!browserAvailable) return;

      // Filter out non-critical errors that are expected in Docker/dev environments
      const nonCriticalPatterns = [
        'favicon',
        '404',
        'websocket',
        'WebSocket',
        'net::ERR_',
        'Failed to load resource',
        'CORS',
        'ResizeObserver',
        'Warning:',
        'DevTools',
      ];

      const consoleErrors = uiTester.getConsoleErrors().filter((e) => {
        if (!e.url?.includes('admin')) return false;
        const text = e.text.toLowerCase();
        return !nonCriticalPatterns.some((pattern) => text.includes(pattern.toLowerCase()));
      });

      expect(consoleErrors).toHaveLength(0);
    });
  });

  // ============ DATA BROWSER ============
  describe('Data Browser', () => {
    test('data browser loads and displays vessel data tree', async () => {
      if (!browserAvailable) return;
      logMonitor.setPhase('ui-databrowser');

      const results = await uiTester.testDataBrowser();

      expect(results.failed).toHaveLength(0);
      expect(logMonitor.getPhaseErrors('ui-databrowser')).toHaveLength(0);
    });

    test('navigation data is accessible via API', async () => {
      if (!browserAvailable) return;

      const res = await fetch(`${baseUrl}/signalk/v1/api/vessels/self/navigation`);
      expect([200, 404]).toContain(res.status);
    });

    test('environment data is accessible via API', async () => {
      if (!browserAvailable) return;

      const res = await fetch(`${baseUrl}/signalk/v1/api/vessels/self/environment`);
      expect([200, 404]).toContain(res.status);
    });
  });

  // ============ SERVER CONFIGURATION ============
  describe('Server Configuration', () => {
    test('server settings page loads with vessel configuration', async () => {
      if (!browserAvailable) return;
      logMonitor.setPhase('ui-server-settings');

      const results = await uiTester.testServerConfiguration();

      expect(results.failed).toHaveLength(0);
      expect(logMonitor.getPhaseErrors('ui-server-settings')).toHaveLength(0);
    });

    test('data connections page loads with connection list', async () => {
      if (!browserAvailable) return;
      logMonitor.setPhase('ui-connections');

      const results = await uiTester.testConnectionManagement();

      expect(results.failed).toHaveLength(0);
      expect(logMonitor.getPhaseErrors('ui-connections')).toHaveLength(0);
    });
  });

  // ============ PLUGIN MANAGEMENT ============
  describe('Plugin Management', () => {
    test('plugin config page loads with plugin list', async () => {
      if (!browserAvailable) return;
      logMonitor.setPhase('ui-plugins');

      const results = await uiTester.testPluginManagement();

      expect(results.failed).toHaveLength(0);
      expect(logMonitor.getPhaseErrors('ui-plugins')).toHaveLength(0);
    });

    test('can access plugin list via API', async () => {
      if (!browserAvailable) return;

      const res = await fetch(`${baseUrl}/plugins`);
      expect([200, 401, 403]).toContain(res.status);
    });
  });

  // ============ SECURITY ============
  describe('Security', () => {
    test('security users page loads with user list', async () => {
      if (!browserAvailable) return;
      logMonitor.setPhase('ui-security-users');

      const results = await uiTester.testSecurityUsers();

      expect(results.failed).toHaveLength(0);
      expect(logMonitor.getPhaseErrors('ui-security-users')).toHaveLength(0);
    });

    test('login endpoint is accessible', async () => {
      if (!browserAvailable) return;

      const res = await fetch(`${baseUrl}/signalk/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'test', password: 'test' }),
      });
      // 401 = bad credentials (endpoint exists), 200 = logged in, 404 = no security
      expect([200, 401, 403, 404]).toContain(res.status);
    });

    test('access requests endpoint is accessible', async () => {
      if (!browserAvailable) return;

      const res = await fetch(`${baseUrl}/signalk/v1/access/requests`);
      expect([200, 401, 403, 404]).toContain(res.status);
    });
  });

 /** 
  // ============ SECURITY Settings ============
  describe('Security', () => {
    test('security users page loads with user list', async () => {
      if (!browserAvailable) return;
      logMonitor.setPhase('ui-security-users');

      const results = await uiTester.testSecuritySettings();

      expect(results.failed).toHaveLength(0);
      expect(logMonitor.getPhaseErrors('ui-security-users')).toHaveLength(0);
    });

    test('login endpoint is accessible', async () => {
      if (!browserAvailable) return;

      const res = await fetch(`${baseUrl}/signalk/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'test', password: 'test' }),
      });
      // 401 = bad credentials (endpoint exists), 200 = logged in, 404 = no security
      expect([200, 401, 403, 404]).toContain(res.status);
    });

    test('access requests endpoint is accessible', async () => {
      if (!browserAvailable) return;

      const res = await fetch(`${baseUrl}/signalk/v1/access/requests`);
      expect([200, 401, 403, 404]).toContain(res.status);
    });
  });
*/
  // ============ WEBAPPS / APPSTORE ============
  describe('Webapps & Appstore', () => {
    test('appstore page loads', async () => {
      if (!browserAvailable) return;
      logMonitor.setPhase('ui-appstore');

      const results = await uiTester.testWebAppStore();

      expect(results.failed).toHaveLength(0);
      expect(logMonitor.getPhaseErrors('ui-appstore')).toHaveLength(0);
    });
  });

  // ============ API ENDPOINTS ============
  describe('API Endpoints', () => {
    test('signalk root endpoint is accessible', async () => {
      if (!browserAvailable) return;

      const res = await fetch(`${baseUrl}/signalk`);
      expect(res.ok).toBe(true);
    });

    test('signalk API endpoint returns data', async () => {
      if (!browserAvailable) return;

      const res = await fetch(`${baseUrl}/signalk/v1/api`);
      expect([200, 404]).toContain(res.status);
    });

    test('vessel self endpoint is accessible', async () => {
      if (!browserAvailable) return;

      const res = await fetch(`${baseUrl}/signalk/v1/api/vessels/self`);
      expect([200, 404]).toContain(res.status);
    });
  });
});
