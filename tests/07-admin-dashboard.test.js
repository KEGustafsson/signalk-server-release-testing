/**
 * Admin UI Dashboard Tests
 *
 * Tests the SignalK Admin UI using browser automation.
 * Skips if Playwright browsers are not installed.
 */

const { ContainerManager } = require('../lib/container-manager');
const { LogMonitor } = require('../lib/log-monitor');
const { AdminUiTester } = require('../lib/admin-ui-tester');
const { NmeaFeeder } = require('../lib/nmea-feeder');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Check if browsers are available before running tests
let browserAvailable = false;
let browserCheckDone = false;

beforeAll(async () => {
  if (!browserCheckDone) {
    browserAvailable = await AdminUiTester.isBrowserAvailable();
    browserCheckDone = true;
    if (!browserAvailable) {
      console.log('Playwright browsers not installed - skipping Admin UI tests');
      console.log('Run "npx playwright install chromium" to enable UI tests');
    }
  }
});

const describeIfBrowser = () => browserAvailable ? describe : describe.skip;

describe('Admin UI - Dashboard & Data Browser', () => {
  let manager;
  let logMonitor;
  let uiTester;
  let feeder;
  let skipTests = false;

  beforeAll(async () => {
    if (!browserAvailable) {
      skipTests = true;
      return;
    }

    logMonitor = new LogMonitor();
    manager = new ContainerManager({
      image: process.env.SIGNALK_IMAGE || 'signalk/signalk-server:latest',
      logMonitor,
    });
    const info = await manager.start();

    uiTester = new AdminUiTester({ baseUrl: info.baseUrl });
    await uiTester.init();

    feeder = new NmeaFeeder({ tcpPort: info.tcpPort });

    // Feed some data so dashboard has something to show
    await feeder.sendTcp([
      '$GPRMC,123519,A,6000.000,N,02400.000,E,5.5,45.0,010125,0.0,E,A*1A',
      '$SDDBT,10.0,f,3.0,M,1.6,F*2A',
      '$WIMWV,270.0,R,15.0,M,A*1A',
    ]);
    await sleep(3000);
  }, 120000);

  afterAll(async () => {
    if (skipTests) return;

    if (uiTester) {
      await uiTester.close();
    }
    if (manager) {
      await manager.remove(true);
    }

    if (logMonitor) {
      const summary = logMonitor.getSummary();
      console.log('\n--- Admin UI Test Log Summary ---');
      console.log(`Total Errors: ${summary.totalErrors}`);
      console.log(`Console Errors: ${uiTester?.getConsoleErrors().length || 0}`);
      console.log(`Screenshots: ${uiTester?.getScreenshots().length || 0}`);
    }
  });

  describe('Dashboard', () => {
    test('dashboard loads without errors', async () => {
      if (!browserAvailable) {
        console.log('Skipped: Playwright browsers not installed');
        return;
      }

      logMonitor.setPhase('ui-dashboard');

      const results = await uiTester.testDashboard();

      expect(results.failed).toHaveLength(0);
      expect(logMonitor.getPhaseErrors('ui-dashboard')).toHaveLength(0);
    });

    test('no JavaScript console errors on dashboard', async () => {
      if (!browserAvailable) {
        console.log('Skipped: Playwright browsers not installed');
        return;
      }

      const consoleErrors = uiTester.getConsoleErrors().filter(
        (e) => e.url?.includes('instrumentpanel') || e.url?.includes('dashboard')
      );

      if (consoleErrors.length > 0) {
        console.log('Console errors:', consoleErrors);
      }

      // Allow some non-critical console errors
      const criticalErrors = consoleErrors.filter(
        (e) =>
          !e.text.includes('favicon') &&
          !e.text.includes('404') &&
          !e.text.includes('websocket')
      );

      expect(criticalErrors).toHaveLength(0);
    });
  });

  describe('Data Browser', () => {
    test('data browser loads without errors', async () => {
      if (!browserAvailable) {
        console.log('Skipped: Playwright browsers not installed');
        return;
      }

      logMonitor.setPhase('ui-databrowser');

      const results = await uiTester.testDataBrowser();

      expect(results.failed).toHaveLength(0);
      expect(logMonitor.getPhaseErrors('ui-databrowser')).toHaveLength(0);
    });
  });
});
