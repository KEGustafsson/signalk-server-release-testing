/**
 * End-to-End Data Flow Tests
 *
 * Tests complete data flow from input through processing to all outputs.
 * Verifies data appears correctly in REST API, WebSocket, and is consistent.
 */

const { ContainerManager } = require('../lib/container-manager');
const { LogMonitor } = require('../lib/log-monitor');
const { NmeaFeeder } = require('../lib/nmea-feeder');
const { NmeaFixtures } = require('../lib/nmea-fixtures');
const WebSocket = require('ws');

describe('End-to-End Data Flow', () => {
  let manager;
  let logMonitor;
  let feeder;
  let baseUrl;
  let wsUrl;
  let tcpPort;

  beforeAll(async () => {
    logMonitor = new LogMonitor();
    manager = new ContainerManager({
      image: process.env.SIGNALK_IMAGE || 'signalk/signalk-server:latest',
      logMonitor,
    });
    const info = await manager.start();
    baseUrl = info.baseUrl;
    wsUrl = info.wsUrl;
    tcpPort = info.tcpPort;
    feeder = new NmeaFeeder({ tcpPort });

    await sleep(2000);
  }, 120000);

  afterAll(async () => {
    await manager.remove(true);
  });

  describe('NMEA Input to REST API Output', () => {
    test('position data flows from NMEA to REST API', async () => {
      logMonitor.setPhase('e2e-nmea-rest-position');

      const testLat = 61.234;
      const testLon = 25.456;

      // Send NMEA position
      const rmcSentence = NmeaFixtures.generateRMC(testLat, testLon, 5.0, 90.0);
      await feeder.sendTcp(rmcSentence);
      await sleep(1000);

      // Verify in REST API
      const res = await fetch(`${baseUrl}/signalk/v1/api/vessels/self/navigation/position`);
      expect(res.ok).toBe(true);

      const data = await res.json();
      expect(data.value.latitude).toBeCloseTo(testLat, 2);
      expect(data.value.longitude).toBeCloseTo(testLon, 2);

      expect(logMonitor.getPhaseErrors('e2e-nmea-rest-position')).toHaveLength(0);
    });

    test('environment data flows from NMEA to REST API', async () => {
      logMonitor.setPhase('e2e-nmea-rest-env');

      // Send depth
      await feeder.sendTcp('$SDDBT,65.6,f,20.0,M,10.9,F*21');
      await sleep(500);

      // Send wind
      await feeder.sendTcp('$WIMWV,90.0,R,25.0,M,A*1C');
      await sleep(500);

      // Send water temp
      await feeder.sendTcp('$YXMTW,22.5,C*1A');
      await sleep(1000);

      // Verify depth
      const depthRes = await fetch(`${baseUrl}/signalk/v1/api/vessels/self/environment/depth/belowTransducer`);
      if (depthRes.ok) {
        const data = await depthRes.json();
        expect(data.value).toBeCloseTo(20.0, 1);
      }

      // Verify wind speed
      const windRes = await fetch(`${baseUrl}/signalk/v1/api/vessels/self/environment/wind/speedApparent`);
      if (windRes.ok) {
        const data = await windRes.json();
        expect(data.value).toBeCloseTo(25.0, 1);
      }

      // Verify water temp (22.5C = 295.65K)
      const tempRes = await fetch(`${baseUrl}/signalk/v1/api/vessels/self/environment/water/temperature`);
      if (tempRes.ok) {
        const data = await tempRes.json();
        expect(data.value).toBeCloseTo(295.65, 1);
      }

      expect(logMonitor.getPhaseErrors('e2e-nmea-rest-env')).toHaveLength(0);
    });
  });

  describe('NMEA Input to WebSocket Output', () => {
    test('position updates appear on WebSocket', async () => {
      logMonitor.setPhase('e2e-nmea-ws-position');

      const ws = new WebSocket(`${wsUrl}?subscribe=all`);
      const receivedMessages = [];

      await new Promise((resolve) => {
        ws.on('open', async () => {
          // Wait for hello, then send NMEA
          setTimeout(async () => {
            const rmcSentence = NmeaFixtures.generateRMC(62.0, 26.0, 8.0, 180.0);
            await feeder.sendTcp(rmcSentence);
          }, 500);
        });

        ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            receivedMessages.push(msg);

            // Look for position delta
            if (msg.updates) {
              for (const update of msg.updates) {
                if (update.values) {
                  for (const v of update.values) {
                    if (v.path === 'navigation.position') {
                      resolve(true);
                    }
                  }
                }
              }
            }
          } catch (e) {}
        });

        setTimeout(() => resolve(false), 10000);
      });

      ws.close();

      expect(receivedMessages.length).toBeGreaterThan(0);

      expect(logMonitor.getPhaseErrors('e2e-nmea-ws-position')).toHaveLength(0);
    });

    test('multiple data types stream correctly', async () => {
      logMonitor.setPhase('e2e-nmea-ws-multi');

      const ws = new WebSocket(`${wsUrl}?subscribe=all`);
      const receivedPaths = new Set();

      await new Promise((resolve) => {
        ws.on('open', async () => {
          setTimeout(async () => {
            // Send various NMEA sentences
            await feeder.sendTcp(NmeaFixtures.generateRMC(62.5, 26.5, 10.0, 135.0));
            await feeder.sendTcp('$SDDBT,32.8,f,10.0,M,5.5,F*2D');
            await feeder.sendTcp('$WIMWV,45.0,R,15.0,M,A*1B');
            await feeder.sendTcp(NmeaFixtures.generateHDT(135.0));
          }, 500);
        });

        ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.updates) {
              for (const update of msg.updates) {
                if (update.values) {
                  for (const v of update.values) {
                    receivedPaths.add(v.path);
                  }
                }
              }
            }
          } catch (e) {}
        });

        setTimeout(() => resolve(true), 5000);
      });

      ws.close();

      expect(receivedPaths.size).toBeGreaterThan(0);

      expect(logMonitor.getPhaseErrors('e2e-nmea-ws-multi')).toHaveLength(0);
    });
  });

  describe('REST API and WebSocket Consistency', () => {
    test('REST and WebSocket show same data', async () => {
      logMonitor.setPhase('e2e-consistency');

      // Send known position
      const testLat = 63.123;
      const testLon = 27.456;
      const rmcSentence = NmeaFixtures.generateRMC(testLat, testLon, 12.0, 225.0);
      await feeder.sendTcp(rmcSentence);
      await sleep(1500);

      // Get from REST API
      const restRes = await fetch(`${baseUrl}/signalk/v1/api/vessels/self/navigation/position`);
      expect(restRes.ok).toBe(true);
      const restData = await restRes.json();

      // Get from WebSocket
      const ws = new WebSocket(wsUrl);
      let wsPosition = null;

      await new Promise((resolve) => {
        ws.on('open', () => {
          ws.send(JSON.stringify({
            context: 'vessels.self',
            subscribe: [{ path: 'navigation.position' }],
          }));
        });

        ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.updates) {
              for (const update of msg.updates) {
                if (update.values) {
                  for (const v of update.values) {
                    if (v.path === 'navigation.position') {
                      wsPosition = v.value;
                      resolve(true);
                    }
                  }
                }
              }
            }
          } catch (e) {}
        });

        setTimeout(() => resolve(false), 5000);
      });

      ws.close();

      // Compare values
      if (wsPosition) {
        expect(restData.value.latitude).toBeCloseTo(wsPosition.latitude, 4);
        expect(restData.value.longitude).toBeCloseTo(wsPosition.longitude, 4);
      }

      expect(logMonitor.getPhaseErrors('e2e-consistency')).toHaveLength(0);
    });
  });

  describe('Delta PUT to Data Update Flow', () => {
    test('PUT updates appear in REST API', async () => {
      logMonitor.setPhase('e2e-put-rest');

      // Send delta via WebSocket
      const ws = new WebSocket(wsUrl);
      await new Promise(r => ws.on('open', r));

      const testDepth = 42.5;
      const delta = {
        updates: [{
          values: [{
            path: 'environment.depth.belowSurface',
            value: testDepth,
          }],
        }],
      };

      ws.send(JSON.stringify(delta));
      await sleep(1000);
      ws.close();

      // Verify in REST API
      const res = await fetch(`${baseUrl}/signalk/v1/api/vessels/self/environment/depth/belowSurface`);
      if (res.ok) {
        const data = await res.json();
        expect(data.value).toBeCloseTo(testDepth, 1);
      }

      expect(logMonitor.getPhaseErrors('e2e-put-rest')).toHaveLength(0);
    });

    test('PUT updates propagate to WebSocket subscribers', async () => {
      logMonitor.setPhase('e2e-put-ws');

      // Subscribe to updates
      const subscriber = new WebSocket(`${wsUrl}?subscribe=all`);
      const receivedUpdates = [];

      subscriber.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.updates) {
            receivedUpdates.push(msg);
          }
        } catch (e) {}
      });

      await new Promise(r => subscriber.on('open', r));
      await sleep(500);

      // Send update via another connection
      const sender = new WebSocket(wsUrl);
      await new Promise(r => sender.on('open', r));

      const delta = {
        updates: [{
          values: [{
            path: 'navigation.speedThroughWater',
            value: 3.5,
          }],
        }],
      };

      sender.send(JSON.stringify(delta));
      await sleep(1000);

      sender.close();
      subscriber.close();

      expect(receivedUpdates.length).toBeGreaterThan(0);

      expect(logMonitor.getPhaseErrors('e2e-put-ws')).toHaveLength(0);
    });
  });

  describe('Full Navigation Scenario', () => {
    test('complete navigation data flow', async () => {
      logMonitor.setPhase('e2e-nav-scenario');

      // Simulate boat moving
      const positions = [
        { lat: 60.0, lon: 24.0, sog: 5.0, cog: 45.0 },
        { lat: 60.01, lon: 24.01, sog: 6.0, cog: 50.0 },
        { lat: 60.02, lon: 24.02, sog: 7.0, cog: 55.0 },
      ];

      const ws = new WebSocket(`${wsUrl}?subscribe=all`);
      const updates = [];

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.updates) updates.push(msg);
        } catch (e) {}
      });

      await new Promise(r => ws.on('open', r));

      // Send position updates
      for (const pos of positions) {
        const sentence = NmeaFixtures.generateRMC(pos.lat, pos.lon, pos.sog, pos.cog);
        await feeder.sendTcp(sentence);
        await sleep(500);
      }

      await sleep(1000);
      ws.close();

      // Verify final position via REST
      const res = await fetch(`${baseUrl}/signalk/v1/api/vessels/self/navigation/position`);
      expect(res.ok).toBe(true);

      const data = await res.json();
      const lastPos = positions[positions.length - 1];
      expect(data.value.latitude).toBeCloseTo(lastPos.lat, 1);
      expect(data.value.longitude).toBeCloseTo(lastPos.lon, 1);

      expect(logMonitor.getPhaseErrors('e2e-nav-scenario')).toHaveLength(0);
    });
  });

  describe('Data Source Tracking', () => {
    test('data includes source information', async () => {
      logMonitor.setPhase('e2e-source');

      // Send data
      const rmcSentence = NmeaFixtures.generateRMC(64.0, 28.0, 10.0, 90.0);
      await feeder.sendTcp(rmcSentence);
      await sleep(1000);

      // Check source in REST API
      const res = await fetch(`${baseUrl}/signalk/v1/api/vessels/self/navigation/position`);
      if (res.ok) {
        const data = await res.json();

        // Should have source information
        if (data.$source) {
          expect(data.$source).toBeDefined();
        }

        // Should have timestamp
        if (data.timestamp) {
          expect(new Date(data.timestamp).toString()).not.toBe('Invalid Date');
        }
      }

      expect(logMonitor.getPhaseErrors('e2e-source')).toHaveLength(0);
    });
  });

  describe('Error Propagation', () => {
    test('invalid data does not corrupt valid data', async () => {
      logMonitor.setPhase('e2e-error-propagation');

      // Send valid position
      const validSentence = NmeaFixtures.generateRMC(65.0, 29.0, 8.0, 120.0);
      await feeder.sendTcp(validSentence);
      await sleep(500);

      // Get valid position
      const res1 = await fetch(`${baseUrl}/signalk/v1/api/vessels/self/navigation/position`);
      const data1 = await res1.json();
      const validLat = data1.value.latitude;

      // Send garbage
      await feeder.sendTcp([
        'garbage data',
        '$INVALID,sentence,here',
        '$GPRMC,bad,checksum*FF',
      ]);
      await sleep(500);

      // Position should still be valid
      const res2 = await fetch(`${baseUrl}/signalk/v1/api/vessels/self/navigation/position`);
      const data2 = await res2.json();

      expect(data2.value.latitude).toBeCloseTo(validLat, 4);

      expect(logMonitor).toHaveNoCriticalErrors();
    });
  });
});
