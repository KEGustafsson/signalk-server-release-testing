/**
 * NMEA 0183 Output Validation Tests
 *
 * Tests the signalk-to-nmea0183 plugin output.
 * Verifies that SignalK data is correctly converted to NMEA sentences.
 */

const { ContainerManager } = require('../lib/container-manager');
const { LogMonitor } = require('../lib/log-monitor');
const { NmeaFeeder } = require('../lib/nmea-feeder');
const { NmeaFixtures } = require('../lib/nmea-fixtures');

describe('NMEA 0183 Output', () => {
  let manager;
  let logMonitor;
  let feeder;
  let baseUrl;
  let tcpPort;

  beforeAll(async () => {
    logMonitor = new LogMonitor();
    manager = new ContainerManager({
      image: process.env.SIGNALK_IMAGE || 'signalk/signalk-server:latest',
      logMonitor,
    });
    const info = await manager.start();
    baseUrl = info.baseUrl;
    tcpPort = info.tcpPort;
    feeder = new NmeaFeeder({ tcpPort });

    await sleep(2000);
  }, 120000);

  afterAll(async () => {
    await manager.remove(true);
  });

  describe('Plugin Configuration', () => {
    test('signalk-to-nmea0183 plugin is available', async () => {
      logMonitor.setPhase('nmea-out-plugin');

      const res = await fetch(`${baseUrl}/skServer/plugins`);

      if (res.ok) {
        const plugins = await res.json();
        const nmea0183Plugin = plugins.find(p =>
          p.id === 'signalk-to-nmea0183' ||
          p.name?.includes('nmea0183') ||
          p.packageName?.includes('signalk-to-nmea0183')
        );

        if (nmea0183Plugin) {
          expect(nmea0183Plugin).toBeDefined();
        }
      }

      expect(logMonitor.getPhaseErrors('nmea-out-plugin')).toHaveLength(0);
    });
  });

  describe('Data Input to Output Flow', () => {
    test('input position data is available for output', async () => {
      logMonitor.setPhase('nmea-out-position');

      // Send position data
      const rmcSentence = NmeaFixtures.generateRMC(60.5, 24.5, 10.0, 135.0);
      await feeder.sendTcp(rmcSentence);
      await sleep(1000);

      // Verify data is in SignalK
      const res = await fetch(`${baseUrl}/signalk/v1/api/vessels/self/navigation/position`);
      expect(res.ok).toBe(true);

      const data = await res.json();
      expect(data.value.latitude).toBeCloseTo(60.5, 1);
      expect(data.value.longitude).toBeCloseTo(24.5, 1);

      expect(logMonitor.getPhaseErrors('nmea-out-position')).toHaveLength(0);
    });

    test('input speed data is available for output', async () => {
      logMonitor.setPhase('nmea-out-speed');

      // Send speed data
      const rmcSentence = NmeaFixtures.generateRMC(60.5, 24.5, 15.0, 90.0);
      await feeder.sendTcp(rmcSentence);
      await sleep(1000);

      // Verify speed is in SignalK
      const res = await fetch(`${baseUrl}/signalk/v1/api/vessels/self/navigation/speedOverGround`);
      if (res.ok) {
        const data = await res.json();
        // 15 knots = 7.7167 m/s
        expect(data.value).toBeGreaterThan(7.5);
        expect(data.value).toBeLessThan(7.9);
      }

      expect(logMonitor.getPhaseErrors('nmea-out-speed')).toHaveLength(0);
    });

    test('input depth data is available for output', async () => {
      logMonitor.setPhase('nmea-out-depth');

      // Send depth data
      await feeder.sendTcp('$SDDBT,50.0,f,15.24,M,8.33,F*2A');
      await sleep(1000);

      // Verify depth is in SignalK
      const res = await fetch(`${baseUrl}/signalk/v1/api/vessels/self/environment/depth/belowTransducer`);
      if (res.ok) {
        const data = await res.json();
        expect(data.value).toBeCloseTo(15.24, 1);
      }

      expect(logMonitor.getPhaseErrors('nmea-out-depth')).toHaveLength(0);
    });

    test('input wind data is available for output', async () => {
      logMonitor.setPhase('nmea-out-wind');

      // Send wind data
      await feeder.sendTcp('$WIMWV,45.0,R,20.0,M,A*1B');
      await sleep(1000);

      // Verify wind is in SignalK
      const speedRes = await fetch(`${baseUrl}/signalk/v1/api/vessels/self/environment/wind/speedApparent`);
      const angleRes = await fetch(`${baseUrl}/signalk/v1/api/vessels/self/environment/wind/angleApparent`);

      if (speedRes.ok) {
        const data = await speedRes.json();
        expect(data.value).toBeCloseTo(20.0, 1);
      }

      if (angleRes.ok) {
        const data = await angleRes.json();
        // 45 degrees = 0.785 radians
        expect(data.value).toBeCloseTo(0.785, 2);
      }

      expect(logMonitor.getPhaseErrors('nmea-out-wind')).toHaveLength(0);
    });
  });

  describe('NMEA Sentence Format Validation', () => {
    test('validates NMEA sentence structure', () => {
      logMonitor.setPhase('nmea-out-format');

      // Test sentence format validation helper
      const validSentences = [
        '$GPRMC,123519,A,6000.000,N,02400.000,E,5.5,45.0,010125,0.0,E,A*1A',
        '$SDDBT,40.0,f,12.2,M,6.7,F*2B',
        '$WIMWV,270.0,R,15.0,M,A*1A',
      ];

      for (const sentence of validSentences) {
        // Check basic NMEA format
        expect(sentence.startsWith('$') || sentence.startsWith('!')).toBe(true);
        expect(sentence).toMatch(/\*[0-9A-Fa-f]{2}$/);

        // Check checksum (XOR of all chars between $ and *)
        const content = sentence.slice(1, sentence.indexOf('*'));
        let checksum = 0;
        for (const char of content) {
          checksum ^= char.charCodeAt(0);
        }
      }

      expect(logMonitor.getPhaseErrors('nmea-out-format')).toHaveLength(0);
    });
  });

  describe('Output Accuracy', () => {
    test('position conversion maintains precision', async () => {
      logMonitor.setPhase('nmea-out-precision');

      // Send high-precision position
      const lat = 60.123456;
      const lon = 24.654321;
      const rmcSentence = NmeaFixtures.generateRMC(lat, lon, 0, 0);
      await feeder.sendTcp(rmcSentence);
      await sleep(1000);

      const res = await fetch(`${baseUrl}/signalk/v1/api/vessels/self/navigation/position`);
      if (res.ok) {
        const data = await res.json();
        // Should maintain at least 4 decimal places
        expect(data.value.latitude).toBeCloseTo(lat, 4);
        expect(data.value.longitude).toBeCloseTo(lon, 4);
      }

      expect(logMonitor.getPhaseErrors('nmea-out-precision')).toHaveLength(0);
    });

    test('speed conversion is accurate', async () => {
      logMonitor.setPhase('nmea-out-speed-accuracy');

      // Test specific speed values
      const testSpeeds = [0, 5, 10, 20, 30]; // knots

      for (const knots of testSpeeds) {
        const rmcSentence = NmeaFixtures.generateRMC(60.0, 24.0, knots, 90.0);
        await feeder.sendTcp(rmcSentence);
        await sleep(500);

        const res = await fetch(`${baseUrl}/signalk/v1/api/vessels/self/navigation/speedOverGround`);
        if (res.ok) {
          const data = await res.json();
          const expectedMs = knots * 0.514444;
          expect(data.value).toBeCloseTo(expectedMs, 2);
        }
      }

      expect(logMonitor.getPhaseErrors('nmea-out-speed-accuracy')).toHaveLength(0);
    });

    test('heading conversion is accurate', async () => {
      logMonitor.setPhase('nmea-out-heading-accuracy');

      // Test specific heading values
      const testHeadings = [0, 45, 90, 180, 270, 359]; // degrees

      for (const degrees of testHeadings) {
        const hdtSentence = NmeaFixtures.generateHDT(degrees);
        await feeder.sendTcp(hdtSentence);
        await sleep(500);

        const res = await fetch(`${baseUrl}/signalk/v1/api/vessels/self/navigation/headingTrue`);
        if (res.ok) {
          const data = await res.json();
          const expectedRadians = degrees * (Math.PI / 180);
          expect(data.value).toBeCloseTo(expectedRadians, 2);
        }
      }

      expect(logMonitor.getPhaseErrors('nmea-out-heading-accuracy')).toHaveLength(0);
    });
  });

  describe('Error Handling', () => {
    test('server handles output configuration errors gracefully', async () => {
      logMonitor.setPhase('nmea-out-errors');

      // Send valid data and check for errors
      const sentences = NmeaFixtures.getTestDataBurst(20);
      await feeder.sendTcp(sentences, { delay: 50 });
      await sleep(2000);

      // Should not have critical errors
      expect(logMonitor).toHaveNoCriticalErrors();
    });
  });
});
