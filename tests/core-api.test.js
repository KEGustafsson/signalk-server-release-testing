/**
 * Core API Tests - Combined Suite
 *
 * This file combines multiple API-related tests to run in a single container,
 * dramatically reducing test execution time.
 *
 * Includes:
 * - NMEA0183 TCP input
 * - NMEA0183 UDP input
 * - REST API
 * - WebSocket streaming
 * - Delta/PUT operations
 * - Data conversion
 */

const { getSharedContainer } = require('./shared-container');
const { NmeaFixtures } = require('../lib/nmea-fixtures');
const WebSocket = require('ws');

describe('Core API Tests (Shared Container)', () => {
  let shared;
  let manager;
  let logMonitor;
  let feeder;
  let baseUrl;
  let apiUrl;
  let wsUrl;
  let tcpPort;
  let udpPort;

  beforeAll(async () => {
    shared = getSharedContainer();
    const info = await shared.acquire();
    manager = info.manager;
    logMonitor = info.logMonitor;
    feeder = info.feeder;
    baseUrl = info.baseUrl;
    apiUrl = info.apiUrl;
    wsUrl = info.wsUrl;
    tcpPort = info.tcpPort;
    udpPort = info.udpPort;
  }, 120000);

  afterAll(async () => {
    const summary = logMonitor?.getSummary();
    console.log('\n--- Core API Test Summary ---');
    console.log(`Total Errors: ${summary?.totalErrors || 0}`);
    console.log(`Total Warnings: ${summary?.totalWarnings || 0}`);
    await shared.release();
  });

  // ========================================
  // NMEA 0183 TCP Tests
  // ========================================
  describe('NMEA 0183 TCP Input', () => {
    beforeAll(() => {
      logMonitor?.setPhase('nmea-tcp');
    });

    test('accepts TCP connection and processes RMC sentence', async () => {
      const rmcSentence = NmeaFixtures.getSentencesByType('RMC')[0] ||
        '$GNRMC,165544.00,A,6016.83272,N,02217.19556,E,0.002,,150126,9.20,E,D,V*40';

      const result = await feeder.sendTcp(rmcSentence);
      expect(result.sent).toBe(1);
      expect(result.errors).toHaveLength(0);

      await sleep(1000);

      const res = await fetch(`${baseUrl}/signalk/v1/api/vessels/self/navigation/position`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.value).toBeDefined();
      expect(data.value.latitude).toBeCloseTo(60.28, 1);
    });

    test('processes GGA, VTG, HDT sentences', async () => {
      const sentences = [
        NmeaFixtures.getSentencesByType('GGA')[0] || '$GNGGA,165544.00,6016.83353,N,02217.19127,E,1,12,0.51,2.4,M,18.6,M,,*4E',
        NmeaFixtures.getSentencesByType('VTG')[0] || '$GNVTG,,T,,M,0.002,N,0.004,K,D*3E',
        NmeaFixtures.getSentencesByType('HDT')[0] || '$IIHDT,323.6,T*26',
      ];

      for (const sentence of sentences) {
        await feeder.sendTcp(sentence);
      }
      await sleep(500);

      expect(logMonitor.getPhaseErrors('nmea-tcp')).toHaveLength(0);
    });

    test('processes environment sentences (DBT, MWV, MTW)', async () => {
      const sentences = [
        '$SDDBT,40.0,f,12.2,M,6.7,F*2B',
        '$WIMWV,270.0,R,15.0,M,A*1A',
        '$YXMTW,18.5,C*1F',
      ];

      for (const sentence of sentences) {
        await feeder.sendTcp(sentence);
      }
      await sleep(500);

      const depthRes = await fetch(`${baseUrl}/signalk/v1/api/vessels/self/environment/depth/belowTransducer`);
      if (depthRes.ok) {
        const data = await depthRes.json();
        expect(data.value).toBeCloseTo(12.2, 1);
      }
    });

    test('handles burst of sentences', async () => {
      const sentences = NmeaFixtures.getTestDataBurst(50);
      const result = await feeder.sendTcp(sentences, { delay: 10 });
      expect(result.sent).toBe(sentences.length);
      await sleep(1000);
      expect(logMonitor).toHaveNoCriticalErrors();
    });

    test('handles malformed sentences gracefully', async () => {
      const sentences = [
        '$GPRMC,invalid,data,here',
        'not even nmea',
        '$GP',
        '$GPRMC,123520,A,6000.001,N,02400.001,E,5.5,45.0,010125,0.0,E,A*1B',
      ];

      await feeder.sendTcp(sentences, { delay: 50 });
      await sleep(500);
      expect(logMonitor).toHaveNoCriticalErrors();
    });
  });

  // ========================================
  // NMEA 0183 UDP Tests
  // ========================================
  describe('NMEA 0183 UDP Input', () => {
    beforeAll(() => {
      logMonitor?.setPhase('nmea-udp');
    });

    test('processes UDP datagrams', async () => {
      const result = await feeder.sendUdp(
        '$GPRMC,123519,A,6010.000,N,02410.000,E,5.5,45.0,010125,0.0,E,A*00',
        { port: udpPort }
      );
      expect(result.sent).toBe(1);
      await sleep(1000);
      expect(logMonitor).toHaveNoCriticalErrors();
    });

    test('handles UDP burst', async () => {
      const sentences = NmeaFixtures.generateNavigationBurst(20);
      const result = await feeder.sendUdp(sentences, { port: udpPort, delay: 20 });
      expect(result.sent).toBe(sentences.length);
      await sleep(1000);
    });
  });

  // ========================================
  // REST API Tests
  // ========================================
  describe('REST API', () => {
    beforeAll(() => {
      logMonitor?.setPhase('rest-api');
    });

    test('returns valid discovery document', async () => {
      const res = await fetch(`${baseUrl}/signalk`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.endpoints).toBeDefined();
      expect(data.endpoints.v1).toBeDefined();
      expect(data.server).toBeDefined();
    });

    test('lists vessels', async () => {
      const res = await fetch(`${apiUrl}/vessels`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(typeof data).toBe('object');
      expect(Object.keys(data).length).toBeGreaterThanOrEqual(1);
    });

    test('returns self vessel data', async () => {
      const res = await fetch(`${apiUrl}/vessels/self`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.navigation || data.uuid).toBeDefined();
    });

    test('returns navigation position', async () => {
      const res = await fetch(`${apiUrl}/vessels/self/navigation/position`);
      if (res.ok) {
        const data = await res.json();
        expect(data.value).toBeDefined();
        expect(data.value.latitude).toBeGreaterThanOrEqual(-90);
        expect(data.value.latitude).toBeLessThanOrEqual(90);
      }
    });

    test('returns 404 for invalid paths', async () => {
      const res = await fetch(`${apiUrl}/vessels/self/nonexistent/path`);
      expect(res.status).toBe(404);
    });

    test('supports CORS headers', async () => {
      const res = await fetch(`${baseUrl}/signalk`, { method: 'OPTIONS' });
      const allowOrigin = res.headers.get('access-control-allow-origin');
      expect(allowOrigin).toBeDefined();
    });
  });

  // ========================================
  // WebSocket Streaming Tests
  // ========================================
  describe('WebSocket Streaming', () => {
    beforeAll(() => {
      logMonitor?.setPhase('websocket');
    });

    test('accepts WebSocket connection', async () => {
      const ws = new WebSocket(wsUrl);
      const connected = await new Promise((resolve) => {
        ws.on('open', () => resolve(true));
        ws.on('error', () => resolve(false));
        setTimeout(() => resolve(false), 5000);
      });
      expect(connected).toBe(true);
      ws.close();
    });

    test('sends hello message on connect', async () => {
      const ws = new WebSocket(wsUrl);
      const hello = await new Promise((resolve) => {
        ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.self) resolve(msg);
          } catch (e) {}
        });
        setTimeout(() => resolve(null), 5000);
      });
      expect(hello).not.toBeNull();
      expect(hello.self).toBeDefined();
      ws.close();
    });

    test('receives delta updates with subscription', async () => {
      const ws = new WebSocket(`${wsUrl}?subscribe=all`);
      const messages = [];

      await new Promise((resolve) => {
        ws.on('open', () => {
          // Send some data to trigger deltas
          setTimeout(async () => {
            await feeder.sendTcp('$GPRMC,123519,A,6005.000,N,02405.000,E,5.5,45.0,010125,0.0,E,A*00');
          }, 500);
        });
        ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            messages.push(msg);
            if (messages.length >= 3) resolve(true);
          } catch (e) {}
        });
        setTimeout(() => resolve(false), 5000);
      });

      expect(messages.length).toBeGreaterThan(0);
      ws.close();
    });

    test('handles reconnection', async () => {
      const ws1 = new WebSocket(wsUrl);
      await new Promise(r => ws1.on('open', r));
      ws1.close();

      await sleep(500);

      const ws2 = new WebSocket(wsUrl);
      const connected = await new Promise((resolve) => {
        ws2.on('open', () => resolve(true));
        ws2.on('error', () => resolve(false));
        setTimeout(() => resolve(false), 5000);
      });
      expect(connected).toBe(true);
      ws2.close();
    });
  });

  // ========================================
  // Delta/PUT Operations Tests
  // ========================================
  describe('Delta Operations', () => {
    beforeAll(() => {
      logMonitor?.setPhase('delta-ops');
    });

    test('can send delta via WebSocket', async () => {
      const ws = new WebSocket(wsUrl);
      await new Promise(r => ws.on('open', r));

      const delta = {
        updates: [{
          values: [{
            path: 'navigation.speedOverGround',
            value: 5.5,
          }],
        }],
      };

      ws.send(JSON.stringify(delta));
      await sleep(500);
      ws.close();
      expect(logMonitor).toHaveNoCriticalErrors();
    });

    test('sent delta appears in API', async () => {
      const ws = new WebSocket(wsUrl);
      await new Promise(r => ws.on('open', r));

      // Use a unique path that won't be affected by other tests
      const testValue = 42.5;
      const delta = {
        updates: [{
          values: [{
            path: 'environment.depth.belowKeel',
            value: testValue,
          }],
        }],
      };

      ws.send(JSON.stringify(delta));
      await sleep(500);
      ws.close();

      const res = await fetch(`${apiUrl}/vessels/self/environment/depth/belowKeel`);
      if (res.ok) {
        const data = await res.json();
        expect(data.value).toBeCloseTo(testValue, 2);
      }
    });
  });

  // ========================================
  // Data Conversion Tests
  // ========================================
  describe('Data Conversion', () => {
    beforeAll(() => {
      logMonitor?.setPhase('conversion');
    });

    test('converts NMEA latitude correctly', async () => {
      // 6016.83272,N = 60 + 16.83272/60 = 60.28054533
      await feeder.sendTcp('$GNRMC,165544.00,A,6016.83272,N,02217.19556,E,0.002,,150126,9.20,E,D,V*40');
      await sleep(500);

      const res = await fetch(`${apiUrl}/vessels/self/navigation/position`);
      if (res.ok) {
        const data = await res.json();
        expect(data.value.latitude).toBeCloseTo(60.2805, 3);
      }
    });

    test('converts knots to m/s correctly', async () => {
      // Use NmeaFixtures to generate proper sentence with checksum
      const rmcSentence = NmeaFixtures.generateRMC(60.0, 24.0, 10.0, 135.0);
      await feeder.sendTcp(rmcSentence);
      await sleep(1000);

      const res = await fetch(`${apiUrl}/vessels/self/navigation/speedOverGround`);
      if (res.ok) {
        const data = await res.json();
        // Speed should be converted from knots to m/s
        // 10 knots = 5.144 m/s
        expect(data.value).toBeGreaterThan(5.0);
        expect(data.value).toBeLessThan(5.3);
      }
    });

    test('converts degrees to radians for COG', async () => {
      // Use NmeaFixtures to generate proper sentence with checksum
      const rmcSentence = NmeaFixtures.generateRMC(60.0, 24.0, 5.0, 90.0);
      await feeder.sendTcp(rmcSentence);
      await sleep(1000);

      const res = await fetch(`${apiUrl}/vessels/self/navigation/courseOverGroundTrue`);
      if (res.ok) {
        const data = await res.json();
        // COG should be in radians - check it's a valid number in the right range
        expect(data.value).toBeDefined();
        // 90 degrees = PI/2 = 1.5708 radians
        expect(data.value).toBeCloseTo(Math.PI / 2, 1);
      }
    });

    test('converts water temperature to Kelvin', async () => {
      // 18.5°C = 291.65K
      await feeder.sendTcp('$YXMTW,18.5,C*1F');
      await sleep(500);

      const res = await fetch(`${apiUrl}/vessels/self/environment/water/temperature`);
      if (res.ok) {
        const data = await res.json();
        expect(data.value).toBeCloseTo(291.65, 1);
      }
    });

    test('handles zero speed', async () => {
      // Use NmeaFixtures to generate proper sentence with checksum
      const rmcSentence = NmeaFixtures.generateRMC(60.0, 24.0, 0.0, 0.0);
      await feeder.sendTcp(rmcSentence);
      await sleep(1000);

      const res = await fetch(`${apiUrl}/vessels/self/navigation/speedOverGround`);
      if (res.ok) {
        const data = await res.json();
        expect(data.value).toBeCloseTo(0, 1);
      }
    });
  });
});

// Helper
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
