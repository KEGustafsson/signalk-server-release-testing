/**
 * NMEA 0183 UDP Input Tests
 *
 * Tests NMEA data input via UDP using realistic test data
 */

const { ContainerManager } = require('../lib/container-manager');
const { LogMonitor } = require('../lib/log-monitor');
const { NmeaFeeder } = require('../lib/nmea-feeder');
const { NmeaFixtures } = require('../lib/nmea-fixtures');

describe('NMEA 0183 UDP Input', () => {
  let manager;
  let logMonitor;
  let feeder;
  let baseUrl;

  beforeAll(async () => {
    logMonitor = new LogMonitor();
    manager = new ContainerManager({
      image: process.env.SIGNALK_IMAGE || 'signalk/signalk-server:latest',
      logMonitor,
    });
    const info = await manager.start();
    baseUrl = info.baseUrl;
    feeder = new NmeaFeeder({ udpPort: info.udpPort });

    await sleep(3000);
  }, 120000);

  afterAll(async () => {
    await manager.remove(true);

    const summary = logMonitor.getSummary();
    console.log('\n--- NMEA UDP Test Log Summary ---');
    console.log(`Total Errors: ${summary.totalErrors}`);
  });

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
