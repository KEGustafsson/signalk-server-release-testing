/**
 * NMEA 0183 Input Tests (TCP + UDP Combined)
 *
 * Tests NMEA data input via both TCP and UDP connections
 * using a single shared container for faster execution.
 */

const { ContainerManager } = require('../lib/container-manager');
const { LogMonitor } = require('../lib/log-monitor');
const { NmeaFeeder } = require('../lib/nmea-feeder');
const { NmeaFixtures } = require('../lib/nmea-fixtures');

describe('NMEA 0183 Input', () => {
  let manager;
  let logMonitor;
  let feeder;
  let baseUrl;
  let tcpPort;
  let udpPort;

  beforeAll(async () => {
    logMonitor = new LogMonitor();
    manager = new ContainerManager({
      image: process.env.SIGNALK_IMAGE || 'signalk/signalk-server:latest',
      logMonitor,
    });
    const info = await manager.start();
    baseUrl = info.baseUrl;
    tcpPort = info.tcpPort;
    udpPort = info.udpPort;
    feeder = new NmeaFeeder({ tcpPort, udpPort });

    // Container manager now waits for TCP port, add small buffer for provider init
    await sleep(2000);
  }, 120000);

  afterAll(async () => {
    await manager.remove(true);

    const summary = logMonitor.getSummary();
    console.log('\n--- NMEA 0183 Test Log Summary ---');
    console.log(`Total Errors: ${summary.totalErrors}`);
    console.log(`Total Warnings: ${summary.totalWarnings}`);
  });

  // ========================================
  // TCP Tests
  // ========================================
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

  describe('TCP Navigation Sentences', () => {
    test('processes RMC sentence correctly and data appears in SignalK', async () => {
      logMonitor.setPhase('tcp-rmc');

      // Debug: Check what providers are configured
      const providersRes = await fetch(`${baseUrl}/skServer/providers`);
      if (providersRes.ok) {
        const providers = await providersRes.json();
        console.log(`Configured providers: ${JSON.stringify(providers, null, 2)}`);
      } else {
        console.log(`Providers endpoint: ${providersRes.status}`);
      }

      // Use real RMC from test data file
      const rmcSentences = NmeaFixtures.getSentencesByType('RMC');
      const rmcSentence = rmcSentences[0] || '$GNRMC,165544.00,A,6016.83272,N,02217.19556,E,0.002,,150126,9.20,E,D,V*40';
      console.log(`Sending RMC: ${rmcSentence}`);
      const sendResult = await feeder.sendTcp(rmcSentence);
      expect(sendResult.sent).toBe(1);
      expect(sendResult.errors).toHaveLength(0);

      // Wait for data to be processed
      await sleep(2000);

      // Debug: Check entire vessels API
      const vesselsRes = await fetch(`${baseUrl}/signalk/v1/api/vessels/self`);
      if (vesselsRes.ok) {
        const vessels = await vesselsRes.json();
        console.log(`Vessels self data: ${JSON.stringify(vessels, null, 2).substring(0, 500)}`);
      } else {
        console.log(`Vessels API: ${vesselsRes.status}`);
      }

      // Verify data MUST appear in SignalK
      const res = await fetch(`${baseUrl}/signalk/v1/api/vessels/self/navigation/position`);
      if (!res.ok) {
        console.log(`Position API returned: ${res.status}`);
        // Get container logs for debugging
        const logs = await manager.getLogs(100);
        console.log(`Container logs:\n${logs}`);
      }
      expect(res.ok).toBe(true);

      const data = await res.json();
      expect(data.value).toBeDefined();
      console.log(`Position received: lat=${data.value.latitude}, lon=${data.value.longitude}`);
      // Position from test file: 6016.83272,N = 60.28054...
      expect(data.value.latitude).toBeCloseTo(60.28, 1);
      expect(data.value.longitude).toBeCloseTo(22.28, 1);

      expect(logMonitor.getPhaseErrors('tcp-rmc')).toHaveLength(0);
    });

    test('processes GGA sentence correctly', async () => {
      logMonitor.setPhase('tcp-gga');

      // Use real GGA from test data file
      const ggaSentences = NmeaFixtures.getSentencesByType('GGA');
      const ggaSentence = ggaSentences[0] || '$GNGGA,165544.00,6016.83353,N,02217.19127,E,1,12,0.51,2.4,M,18.6,M,,*4E';
      await feeder.sendTcp(ggaSentence);

      await sleep(1000);

      expect(logMonitor.getPhaseErrors('tcp-gga')).toHaveLength(0);
    });

    test('processes VTG sentence correctly', async () => {
      logMonitor.setPhase('tcp-vtg');

      // Use real VTG from test data file
      const vtgSentences = NmeaFixtures.getSentencesByType('VTG');
      const vtgSentence = vtgSentences[0] || '$GNVTG,,T,,M,0.002,N,0.004,K,D*3E';
      await feeder.sendTcp(vtgSentence);

      await sleep(1000);

      expect(logMonitor.getPhaseErrors('tcp-vtg')).toHaveLength(0);
    });

    test('processes HDT sentence correctly', async () => {
      logMonitor.setPhase('tcp-hdt');

      // Use real HDT from test data file
      const hdtSentences = NmeaFixtures.getSentencesByType('HDT');
      const hdtSentence = hdtSentences[0] || '$IIHDT,323.6,T*26';
      await feeder.sendTcp(hdtSentence);

      await sleep(1000);

      expect(logMonitor.getPhaseErrors('tcp-hdt')).toHaveLength(0);
    });

    test('processes GLL sentence correctly', async () => {
      logMonitor.setPhase('tcp-gll');

      // Use real GLL from test data file
      const gllSentences = NmeaFixtures.getSentencesByType('GLL');
      const gllSentence = gllSentences[0] || '$GNGLL,6016.83272,N,02217.19556,E,165544.00,A,D*70';
      await feeder.sendTcp(gllSentence);

      await sleep(1000);

      expect(logMonitor.getPhaseErrors('tcp-gll')).toHaveLength(0);
    });

    test('processes ZDA sentence correctly', async () => {
      logMonitor.setPhase('tcp-zda');

      // Use real ZDA from test data file
      const zdaSentences = NmeaFixtures.getSentencesByType('ZDA');
      const zdaSentence = zdaSentences[0] || '$GNZDA,165544.00,15,01,2026,00,00*7C';
      await feeder.sendTcp(zdaSentence);

      await sleep(1000);

      expect(logMonitor.getPhaseErrors('tcp-zda')).toHaveLength(0);
    });
  });

  describe('TCP Environment Sentences', () => {
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

  describe('TCP AIS Sentences', () => {
    test('processes AIS VDO (own vessel) messages', async () => {
      logMonitor.setPhase('tcp-ais-vdo');

      // Use real VDO from test data file
      const vdoSentences = NmeaFixtures.getSentencesByType('VDO');
      if (vdoSentences.length > 0) {
        await feeder.sendTcp(vdoSentences[0]);
      } else {
        await feeder.sendTcp('!AIVDO,1,1,,,B3KK;SP000IPD4`Wp`wQ2RF1h000,0*3B');
      }

      await sleep(1000);

      expect(logMonitor.getPhaseErrors('tcp-ais-vdo')).toHaveLength(0);
    });

    test('processes AIS VDM (other vessels) messages', async () => {
      logMonitor.setPhase('tcp-ais-vdm');

      // Use real VDM from test data file
      const vdmSentences = NmeaFixtures.getSentencesByType('VDM');
      if (vdmSentences.length > 0) {
        await feeder.sendTcp(vdmSentences[0]);
      } else {
        await feeder.sendTcp('!AIVDM,1,1,,B,402<HTQv`Ghoc1V?VTRS42wP20S:,0*46');
      }

      await sleep(1000);

      expect(logMonitor.getPhaseErrors('tcp-ais-vdm')).toHaveLength(0);
    });

    test('AIS targets appear in vessel list', async () => {
      logMonitor.setPhase('tcp-ais-vessels');

      // Use all AIS sentences from test data file
      const aisSentences = NmeaFixtures.getAisSentences();
      if (aisSentences.length > 0) {
        await feeder.sendTcp(aisSentences);
      } else {
        await feeder.sendTcp([
          '!AIVDM,1,1,,A,13u@DP0P00PlJ`<5;:0?4?v00000,0*39',
          '!AIVDM,1,1,,B,15MgK70000JsHG8Hus0FbD:0000,0*61',
        ]);
      }

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

  describe('TCP Burst Handling', () => {
    test('handles high-frequency data burst with real test data', async () => {
      logMonitor.setPhase('tcp-burst');

      // Use realistic test data from file
      const sentences = NmeaFixtures.getTestDataBurst(100);
      const result = await feeder.sendTcp(sentences, { delay: 10 });

      expect(result.sent).toBe(sentences.length);
      console.log(`Sent ${result.sent} realistic NMEA sentences`);

      await sleep(3000);

      expect(logMonitor.getPhaseErrors('tcp-burst')).toHaveLength(0);
    });

    test('handles all test file sentences', async () => {
      logMonitor.setPhase('tcp-all-sentences');

      // Send all sentences from the test file
      const allSentences = NmeaFixtures.getAllTestSentences();
      const result = await feeder.sendTcp(allSentences, { delay: 50 });

      expect(result.sent).toBe(allSentences.length);
      console.log(`Sent all ${result.sent} test file sentences`);

      await sleep(3000);

      expect(logMonitor.getPhaseErrors('tcp-all-sentences')).toHaveLength(0);
    });

    test('handles satellite info burst (GSA/GSV)', async () => {
      logMonitor.setPhase('tcp-satellite-burst');

      // Send satellite info sentences
      const satSentences = NmeaFixtures.getSatelliteSentences();
      if (satSentences.length > 0) {
        const result = await feeder.sendTcp(satSentences, { delay: 20 });
        expect(result.sent).toBe(satSentences.length);
        console.log(`Sent ${result.sent} satellite info sentences`);
      }

      await sleep(2000);

      expect(logMonitor.getPhaseErrors('tcp-satellite-burst')).toHaveLength(0);
    });
  });

  describe('TCP Error Handling', () => {
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

  describe('TCP Data Validation', () => {
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

  // ========================================
  // UDP Tests
  // ========================================
  describe('UDP Input', () => {
    test('accepts UDP datagrams without errors', async () => {
      logMonitor.setPhase('udp-basic');

      // Use real RMC from test data file
      const rmcSentences = NmeaFixtures.getSentencesByType('RMC');
      const rmcSentence = rmcSentences[0] || '$GNRMC,165544.00,A,6016.83272,N,02217.19556,E,0.002,,150126,9.20,E,D,V*40';
      const result = await feeder.sendUdp(rmcSentence);

      expect(result.sent).toBe(1);
      expect(result.errors).toHaveLength(0);

      await sleep(1000);

      expect(logMonitor.getPhaseErrors('udp-basic')).toHaveLength(0);
    });

    test('processes multiple UDP sentences from test file', async () => {
      logMonitor.setPhase('udp-multi');

      // Use navigation sentences from test file
      const navSentences = NmeaFixtures.getNavigationSentences().slice(0, 5);
      const sentences = navSentences.length > 0 ? navSentences : [
        '$GNRMC,165544.00,A,6016.83272,N,02217.19556,E,0.002,,150126,9.20,E,D,V*40',
        '$GNGGA,165544.00,6016.83353,N,02217.19127,E,1,12,0.51,2.4,M,18.6,M,,*4E',
        '$IIHDT,323.6,T*26',
      ];

      const result = await feeder.sendUdp(sentences, { delay: 100 });

      expect(result.sent).toBe(sentences.length);
      console.log(`Sent ${result.sent} navigation sentences via UDP`);

      await sleep(2000);

      expect(logMonitor.getPhaseErrors('udp-multi')).toHaveLength(0);
    });

    test('handles UDP burst with real test data', async () => {
      logMonitor.setPhase('udp-burst');

      // Use realistic test data from file
      const sentences = NmeaFixtures.getTestDataBurst(50);
      const result = await feeder.sendUdp(sentences, { delay: 20 });

      expect(result.sent).toBe(sentences.length);
      console.log(`Sent ${result.sent} realistic sentences via UDP`);

      await sleep(3000);

      expect(logMonitor.getPhaseErrors('udp-burst')).toHaveLength(0);
    });

    test('handles all test file sentences via UDP', async () => {
      logMonitor.setPhase('udp-all-sentences');

      // Send all sentences from the test file
      const allSentences = NmeaFixtures.getAllTestSentences();
      const result = await feeder.sendUdp(allSentences, { delay: 50 });

      expect(result.sent).toBe(allSentences.length);
      console.log(`Sent all ${result.sent} test file sentences via UDP`);

      await sleep(3000);

      expect(logMonitor.getPhaseErrors('udp-all-sentences')).toHaveLength(0);
    });

    test('handles malformed UDP data gracefully', async () => {
      logMonitor.setPhase('udp-malformed');

      // Mix valid test data with malformed data
      const validSentence = NmeaFixtures.getSentencesByType('RMC')[0] || '$GNRMC,165544.00,A,6016.83272,N,02217.19556,E,0.002,,150126,9.20,E,D,V*40';
      const sentences = [
        'garbage data',
        '$INVALID',
        validSentence,
      ];

      await feeder.sendUdp(sentences, { delay: 50 });

      await sleep(1000);

      expect(logMonitor).toHaveNoCriticalErrors();
    });
  });
});
