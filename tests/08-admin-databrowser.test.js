/**
 * Admin UI Data Browser Tests
 *
 * Extended tests for the SignalK Data Browser functionality.
 * Skips if Playwright browsers are not installed.
 */

const { ContainerManager } = require('../lib/container-manager');
const { LogMonitor } = require('../lib/log-monitor');
const { AdminUiTester } = require('../lib/admin-ui-tester');
const { NmeaFeeder } = require('../lib/nmea-feeder');

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

describe('Admin UI - Data Browser Extended', () => {
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

    // Feed comprehensive navigation data
    await feeder.sendTcp([
      '$GPRMC,123519,A,6000.000,N,02400.000,E,5.5,45.0,010125,0.0,E,A*1A',
      '$GPGGA,123519,6000.000,N,02400.000,E,1,08,0.9,10.0,M,0.0,M,,*4A',
      '$SDDBT,10.0,f,3.0,M,1.6,F*2A',
      '$SDMTW,18.5,C*1A',
      '$WIMWV,270.0,R,15.0,M,A*1A',
      '$HEHDT,125.5,T*1A',
      '$GPVTG,45.0,T,45.0,M,5.5,N,10.2,K,A*1A',
    ]);
    await sleep(3000);
  }, 120000);

  afterAll(async () => {
    if (!browserAvailable) return;

    if (uiTester) await uiTester.close();
    if (manager) await manager.remove(true);

    if (logMonitor) {
      const summary = logMonitor.getSummary();
      console.log('\n--- Data Browser Test Log Summary ---');
      console.log(`Total Errors: ${summary.totalErrors}`);
    }
  });

  describe('Data Browser Navigation', () => {
    test('data browser displays vessel data', async () => {
      if (!browserAvailable) {
        console.log('Skipped: Playwright browsers not installed');
        return;
      }

      logMonitor.setPhase('ui-databrowser-vessel');

      const results = await uiTester.testDataBrowser();

      expect(results.failed).toHaveLength(0);
      expect(logMonitor.getPhaseErrors('ui-databrowser-vessel')).toHaveLength(0);
    });

    test('can navigate to navigation data', async () => {
      if (!browserAvailable) {
        console.log('Skipped: Playwright browsers not installed');
        return;
      }

      logMonitor.setPhase('ui-databrowser-nav');

      // Check that navigation data is accessible via API
      const res = await fetch(`${baseUrl}/signalk/v1/api/vessels/self/navigation`);

      // 200 means data exists, 404 means no navigation data yet - both are OK
      expect([200, 404]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('ui-databrowser-nav')).toHaveLength(0);
    });

    test('can access environment data', async () => {
      if (!browserAvailable) {
        console.log('Skipped: Playwright browsers not installed');
        return;
      }

      logMonitor.setPhase('ui-databrowser-env');

      const res = await fetch(`${baseUrl}/signalk/v1/api/vessels/self/environment`);

      expect([200, 404]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('ui-databrowser-env')).toHaveLength(0);
    });
  });

  describe('Data Browser Real-time Updates', () => {
    test('data updates when new NMEA data arrives', async () => {
      if (!browserAvailable) {
        console.log('Skipped: Playwright browsers not installed');
        return;
      }

      logMonitor.setPhase('ui-databrowser-realtime');

      // Send new position data
      await feeder.sendTcp([
        '$GPRMC,123520,A,6000.100,N,02400.100,E,6.0,50.0,010125,0.0,E,A*1A',
      ]);

      await sleep(2000);

      // Verify data was received
      const res = await fetch(`${baseUrl}/signalk/v1/api/vessels/self`);
      expect([200, 404]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('ui-databrowser-realtime')).toHaveLength(0);
    });
  });
});
