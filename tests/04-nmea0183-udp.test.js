/**
 * NMEA 0183 UDP Input Tests
 *
 * Tests NMEA data input via UDP
 */

const { ContainerManager } = require('../lib/container-manager');
const { LogMonitor } = require('../lib/log-monitor');
const { NmeaFeeder } = require('../lib/nmea-feeder');

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

      const result = await feeder.sendUdp(
        '$GPRMC,123519,A,6000.000,N,02400.000,E,0.0,0.0,010125,0.0,E,A*29'
      );

      expect(result.sent).toBe(1);
      expect(result.errors).toHaveLength(0);

      await sleep(1000);

      expect(logMonitor.getPhaseErrors('udp-basic')).toHaveLength(0);
    });

    test('processes multiple UDP sentences', async () => {
      logMonitor.setPhase('udp-multi');

      const sentences = [
        '$GPRMC,123519,A,6009.000,N,02459.000,E,5.5,45.0,010125,0.0,E,A*1A',
        '$SDDBT,40.0,f,12.2,M,6.7,F*2B',
        '$WIMWV,270.0,R,15.0,M,A*1A',
      ];

      const result = await feeder.sendUdp(sentences, { delay: 100 });

      expect(result.sent).toBe(sentences.length);

      await sleep(2000);

      expect(logMonitor.getPhaseErrors('udp-multi')).toHaveLength(0);
    });

    test('handles UDP burst', async () => {
      logMonitor.setPhase('udp-burst');

      const sentences = feeder.generateNavigationBurst(50);
      const result = await feeder.sendUdp(sentences, { delay: 20 });

      expect(result.sent).toBe(sentences.length);

      await sleep(3000);

      expect(logMonitor.getPhaseErrors('udp-burst')).toHaveLength(0);
    });

    test('handles malformed UDP data gracefully', async () => {
      logMonitor.setPhase('udp-malformed');

      const sentences = [
        'garbage data',
        '$INVALID',
        '$GPRMC,123519,A,6000.000,N,02400.000,E,5.5,45.0,010125,0.0,E,A*1A',
      ];

      await feeder.sendUdp(sentences, { delay: 50 });

      await sleep(1000);

      expect(logMonitor).toHaveNoCriticalErrors();
    });
  });
});
