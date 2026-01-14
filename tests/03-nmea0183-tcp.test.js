/**
 * NMEA 0183 TCP Input Tests
 *
 * Tests NMEA data input via TCP connection
 * with various sentence types and scenarios.
 */

const { ContainerManager } = require('../lib/container-manager');
const { LogMonitor } = require('../lib/log-monitor');
const { NmeaFeeder } = require('../lib/nmea-feeder');

describe('NMEA 0183 TCP Input', () => {
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

    // Wait for TCP listener to be ready
    await sleep(3000);
  }, 120000);

  afterAll(async () => {
    await manager.remove(true);

    const summary = logMonitor.getSummary();
    console.log('\n--- NMEA TCP Test Log Summary ---');
    console.log(`Total Errors: ${summary.totalErrors}`);
    console.log(`Total Warnings: ${summary.totalWarnings}`);
  });

  describe('TCP Connection', () => {
    test('accepts TCP connection without errors', async () => {
      logMonitor.setPhase('tcp-connect');

      const result = await feeder.sendTcp(
        '$GPRMC,123519,A,6000.000,N,02400.000,E,0.0,0.0,010125,0.0,E,A*29'
      );

      expect(result.sent).toBe(1);
      expect(result.errors).toHaveLength(0);

      const report = logMonitor.getPhaseReport('tcp-connect');
      expect(report.errors).toHaveLength(0);
    });

    test('handles multiple connections', async () => {
      logMonitor.setPhase('tcp-multi-connect');

      // Send from multiple "clients"
      const promises = Array(5)
        .fill(null)
        .map(() =>
          feeder.sendTcp(
            '$GPRMC,123520,A,6000.000,N,02400.000,E,5.0,90.0,010125,0.0,E,A*28'
          )
        );

      const results = await Promise.all(promises);

      for (const result of results) {
        expect(result.sent).toBe(1);
      }

      expect(logMonitor.getPhaseErrors('tcp-multi-connect')).toHaveLength(0);
    });
  });

  describe('Navigation Sentences', () => {
    test('processes RMC sentence correctly', async () => {
      logMonitor.setPhase('tcp-rmc');

      await feeder.sendTcp(
        '$GPRMC,123519,A,6009.000,N,02459.000,E,5.5,45.0,010125,0.0,E,A*1A'
      );

      await sleep(1000);

      // Verify data appears in SignalK
      const res = await fetch(`${baseUrl}/signalk/v1/api/vessels/self/navigation/position`);
      
      if (res.ok) {
        const data = await res.json();
        expect(data.value).toBeDefined();
        expect(data.value.latitude).toBeCloseTo(60.15, 1);
        expect(data.value.longitude).toBeCloseTo(24.983, 1);
      }

      expect(logMonitor.getPhaseErrors('tcp-rmc')).toHaveLength(0);
    });

    test('processes GGA sentence correctly', async () => {
      logMonitor.setPhase('tcp-gga');

      await feeder.sendTcp(
        '$GPGGA,123519,6009.000,N,02459.000,E,1,08,0.9,10.0,M,47.0,M,,*5F'
      );

      await sleep(1000);

      expect(logMonitor.getPhaseErrors('tcp-gga')).toHaveLength(0);
    });

    test('processes VTG sentence correctly', async () => {
      logMonitor.setPhase('tcp-vtg');

      await feeder.sendTcp('$GPVTG,45.0,T,40.0,M,5.5,N,10.2,K,A*2C');

      await sleep(1000);

      expect(logMonitor.getPhaseErrors('tcp-vtg')).toHaveLength(0);
    });

    test('processes HDG sentence correctly', async () => {
      logMonitor.setPhase('tcp-hdg');

      await feeder.sendTcp('$HCHDG,98.3,0.0,E,12.6,W*57');

      await sleep(1000);

      expect(logMonitor.getPhaseErrors('tcp-hdg')).toHaveLength(0);
    });

    test('processes HDT sentence correctly', async () => {
      logMonitor.setPhase('tcp-hdt');

      await feeder.sendTcp('$HCHDT,95.5,T*1B');

      await sleep(1000);

      expect(logMonitor.getPhaseErrors('tcp-hdt')).toHaveLength(0);
    });
  });

  describe('Environment Sentences', () => {
    test('processes DBT (depth) sentence correctly', async () => {
      logMonitor.setPhase('tcp-dbt');

      await feeder.sendTcp('$SDDBT,40.0,f,12.2,M,6.7,F*2B');

      await sleep(1000);

      // Check depth value
      const res = await fetch(
        `${baseUrl}/signalk/v1/api/vessels/self/environment/depth/belowTransducer`
      );
      
      if (res.ok) {
        const data = await res.json();
        expect(data.value).toBeCloseTo(12.2, 1);
      }

      expect(logMonitor.getPhaseErrors('tcp-dbt')).toHaveLength(0);
    });

    test('processes MWV (wind) sentence correctly', async () => {
      logMonitor.setPhase('tcp-mwv');

      // Apparent wind
      await feeder.sendTcp('$WIMWV,270.0,R,15.0,M,A*1A');
      // True wind
      await feeder.sendTcp('$WIMWV,280.0,T,12.0,M,A*1D');

      await sleep(1000);

      expect(logMonitor.getPhaseErrors('tcp-mwv')).toHaveLength(0);
    });

    test('processes XDR (transducer) sentence correctly', async () => {
      logMonitor.setPhase('tcp-xdr');

      await feeder.sendTcp('$YXXDR,C,25.5,C,TEMP*55');

      await sleep(1000);

      expect(logMonitor.getPhaseErrors('tcp-xdr')).toHaveLength(0);
    });

    test('processes MTW (water temperature) sentence correctly', async () => {
      logMonitor.setPhase('tcp-mtw');

      await feeder.sendTcp('$YXMTW,18.5,C*1F');

      await sleep(1000);

      expect(logMonitor.getPhaseErrors('tcp-mtw')).toHaveLength(0);
    });
  });

  describe('AIS Sentences', () => {
    test('processes AIS Class A position report', async () => {
      logMonitor.setPhase('tcp-ais-a');

      await feeder.sendTcp('!AIVDM,1,1,,A,13u@DP0P00PlJ`<5;:0?4?v00000,0*39');

      await sleep(1000);

      expect(logMonitor.getPhaseErrors('tcp-ais-a')).toHaveLength(0);
    });

    test('processes AIS Class B position report', async () => {
      logMonitor.setPhase('tcp-ais-b');

      await feeder.sendTcp('!AIVDM,1,1,,B,15MgK70000JsHG8Hus0FbD:0000,0*61');

      await sleep(1000);

      expect(logMonitor.getPhaseErrors('tcp-ais-b')).toHaveLength(0);
    });

    test('AIS targets appear in vessel list', async () => {
      logMonitor.setPhase('tcp-ais-vessels');

      // Send a few AIS messages
      await feeder.sendTcp([
        '!AIVDM,1,1,,A,13u@DP0P00PlJ`<5;:0?4?v00000,0*39',
        '!AIVDM,1,1,,B,15MgK70000JsHG8Hus0FbD:0000,0*61',
      ]);

      await sleep(2000);

      const res = await fetch(`${baseUrl}/signalk/v1/api/vessels`);
      if (res.ok) {
        const vessels = await res.json();
        const vesselCount = Object.keys(vessels).length;
        expect(vesselCount).toBeGreaterThanOrEqual(1); // At least self
      }

      expect(logMonitor.getPhaseErrors('tcp-ais-vessels')).toHaveLength(0);
    });
  });

  describe('Burst Handling', () => {
    test('handles high-frequency data burst', async () => {
      logMonitor.setPhase('tcp-burst');

      const sentences = feeder.generateNavigationBurst(100);
      const result = await feeder.sendTcp(sentences, { delay: 10 });

      expect(result.sent).toBe(sentences.length);

      await sleep(3000);

      expect(logMonitor.getPhaseErrors('tcp-burst')).toHaveLength(0);
    });

    test('handles mixed sentence burst', async () => {
      logMonitor.setPhase('tcp-mixed-burst');

      const navSentences = feeder.generateNavigationBurst(50);
      const envSentences = feeder.generateEnvironmentBurst(50);
      const allSentences = [...navSentences, ...envSentences];

      // Shuffle
      for (let i = allSentences.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allSentences[i], allSentences[j]] = [allSentences[j], allSentences[i]];
      }

      const result = await feeder.sendTcp(allSentences, { delay: 20 });

      expect(result.sent).toBe(allSentences.length);

      await sleep(3000);

      expect(logMonitor.getPhaseErrors('tcp-mixed-burst')).toHaveLength(0);
    });
  });

  describe('Error Handling', () => {
    test('handles malformed sentences gracefully', async () => {
      logMonitor.setPhase('tcp-malformed');

      const sentences = [
        '$GPRMC,123519,A,6000.000,N,02400.000,E,5.5,45.0,010125,0.0,E,A*1A', // Valid
        '$GPRMC,invalid,data,here', // Malformed
        '$XXYYY,something,wrong*00', // Unknown
        'not even nmea at all',
        '$GP', // Truncated
        '$GPRMC,123520,A,6000.001,N,02400.001,E,5.5,45.0,010125,0.0,E,A*1B', // Valid
      ];

      const result = await feeder.sendTcp(sentences, { delay: 100 });

      expect(result.sent).toBe(sentences.length);

      await sleep(2000);

      // Should not crash - might have warnings but no critical errors
      const report = logMonitor.getPhaseReport('tcp-malformed');
      const criticalErrors = report.errors.filter((e) =>
        /crash|fatal|uncaught|segfault/i.test(e.line)
      );
      expect(criticalErrors).toHaveLength(0);
    });

    test('handles invalid checksum gracefully', async () => {
      logMonitor.setPhase('tcp-bad-checksum');

      await feeder.sendTcp('$GPRMC,123519,A,6000.000,N,02400.000,E,5.5,45.0,010125,0.0,E,A*FF');

      await sleep(1000);

      expect(logMonitor).toHaveNoCriticalErrors();
    });

    test('handles empty lines gracefully', async () => {
      logMonitor.setPhase('tcp-empty');

      await feeder.sendTcp(['', '  ', '\t', '$GPRMC,123519,A,6000.000,N,02400.000,E,5.5,45.0,010125,0.0,E,A*1A']);

      await sleep(1000);

      expect(logMonitor.getPhaseErrors('tcp-empty')).toHaveLength(0);
    });
  });

  describe('Data Validation', () => {
    test('position values are within valid range', async () => {
      logMonitor.setPhase('tcp-validation');

      // Send position
      await feeder.sendTcp(
        '$GPRMC,123519,A,6009.000,N,02459.000,E,5.5,45.0,010125,0.0,E,A*1A'
      );

      await sleep(1000);

      const res = await fetch(`${baseUrl}/signalk/v1/api/vessels/self/navigation/position`);
      
      if (res.ok) {
        const data = await res.json();
        expect(data.value.latitude).toBeGreaterThanOrEqual(-90);
        expect(data.value.latitude).toBeLessThanOrEqual(90);
        expect(data.value.longitude).toBeGreaterThanOrEqual(-180);
        expect(data.value.longitude).toBeLessThanOrEqual(180);
      }
    });

    test('speed values are positive', async () => {
      const res = await fetch(
        `${baseUrl}/signalk/v1/api/vessels/self/navigation/speedOverGround`
      );
      
      if (res.ok) {
        const data = await res.json();
        expect(data.value).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
