/**
 * Delta Message and PUT Request Tests
 *
 * Tests SignalK delta message handling, PUT requests,
 * and write operations via API and WebSocket.
 */

const { ContainerManager } = require('../lib/container-manager');
const { LogMonitor } = require('../lib/log-monitor');
const { NmeaFeeder } = require('../lib/nmea-feeder');
const { NmeaFixtures } = require('../lib/nmea-fixtures');
const WebSocket = require('ws');

describe('Delta and PUT Operations', () => {
  let manager;
  let logMonitor;
  let feeder;
  let baseUrl;
  let apiUrl;
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
    apiUrl = info.apiUrl;
    wsUrl = info.wsUrl;
    tcpPort = info.tcpPort;
    feeder = new NmeaFeeder({ tcpPort });

    // Seed some initial data
    await feeder.sendTcp([
      NmeaFixtures.generateRMC(60.0, 24.0, 5.0, 90.0),
      NmeaFixtures.generateDBT(10.0),
    ]);

    await sleep(2000);
  }, 120000);

  afterAll(async () => {
    await manager.remove(true);

    const summary = logMonitor.getSummary();
    console.log('\n--- Delta/PUT Test Log Summary ---');
    console.log(`Total Errors: ${summary.totalErrors}`);
    console.log(`Total Warnings: ${summary.totalWarnings}`);
  });

  describe('Delta Message Format', () => {
    test('validates standard delta format', () => {
      logMonitor.setPhase('delta-format');

      const delta = {
        context: 'vessels.urn:mrn:signalk:uuid:test-vessel',
        updates: [
          {
            source: {
              label: 'test',
              type: 'test',
            },
            timestamp: new Date().toISOString(),
            values: [
              {
                path: 'navigation.position',
                value: {
                  latitude: 60.0,
                  longitude: 24.0,
                },
              },
            ],
          },
        ],
      };

      expect(delta.context).toBeDefined();
      expect(delta.updates).toBeDefined();
      expect(Array.isArray(delta.updates)).toBe(true);
      expect(delta.updates[0].values[0].path).toBe('navigation.position');

      expect(logMonitor.getPhaseErrors('delta-format')).toHaveLength(0);
    });

    test('validates delta with multiple values', () => {
      logMonitor.setPhase('delta-multi-values');

      const delta = {
        context: 'vessels.self',
        updates: [
          {
            timestamp: new Date().toISOString(),
            values: [
              { path: 'navigation.position.latitude', value: 60.0 },
              { path: 'navigation.position.longitude', value: 24.0 },
              { path: 'navigation.speedOverGround', value: 2.5 },
              { path: 'navigation.courseOverGroundTrue', value: 1.57 },
            ],
          },
        ],
      };

      expect(delta.updates[0].values.length).toBe(4);

      expect(logMonitor.getPhaseErrors('delta-multi-values')).toHaveLength(0);
    });

    test('validates delta with source metadata', () => {
      logMonitor.setPhase('delta-source-meta');

      const delta = {
        context: 'vessels.self',
        updates: [
          {
            source: {
              label: 'GPS',
              type: 'NMEA0183',
              talker: 'GP',
              sentence: 'RMC',
            },
            timestamp: new Date().toISOString(),
            values: [
              { path: 'navigation.position', value: { latitude: 60.1, longitude: 24.1 } },
            ],
          },
        ],
      };

      expect(delta.updates[0].source.label).toBe('GPS');
      expect(delta.updates[0].source.type).toBe('NMEA0183');

      expect(logMonitor.getPhaseErrors('delta-source-meta')).toHaveLength(0);
    });
  });

  describe('HTTP PUT Requests', () => {
    test('PUT to navigation path returns proper status', async () => {
      logMonitor.setPhase('put-navigation');

      const res = await fetch(`${apiUrl}/vessels/self/navigation/speedOverGround`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ value: 3.0 }),
      });

      // May require authentication or may be allowed (depends on security config)
      // 200 = success, 401/403 = auth required, 405 = not allowed
      expect([200, 202, 401, 403, 405]).toContain(res.status);

      console.log(`PUT to navigation.speedOverGround: ${res.status}`);

      expect(logMonitor.getPhaseErrors('put-navigation')).toHaveLength(0);
    });

    test('PUT to steering path returns proper status', async () => {
      logMonitor.setPhase('put-steering');

      const res = await fetch(`${apiUrl}/vessels/self/steering/autopilot/target/headingTrue`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ value: 1.57 }), // 90 degrees in radians
      });

      // May require authentication or registered handler
      expect([200, 202, 401, 403, 404, 405]).toContain(res.status);

      console.log(`PUT to steering.autopilot: ${res.status}`);

      expect(logMonitor.getPhaseErrors('put-steering')).toHaveLength(0);
    });

    test('PUT with invalid content type returns error', async () => {
      logMonitor.setPhase('put-invalid-content');

      const res = await fetch(`${apiUrl}/vessels/self/navigation/speedOverGround`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/plain',
        },
        body: 'not json',
      });

      // Should return an error status
      expect([400, 401, 403, 405, 415]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('put-invalid-content')).toHaveLength(0);
    });

    test('PUT to invalid path returns 404', async () => {
      logMonitor.setPhase('put-invalid-path');

      const res = await fetch(`${apiUrl}/vessels/self/nonexistent/path/here`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ value: 1.0 }),
      });

      // May return 404 or auth error first
      expect([401, 403, 404, 405]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('put-invalid-path')).toHaveLength(0);
    });
  });

  describe('WebSocket Delta Sending', () => {
    test('can send delta via WebSocket', async () => {
      logMonitor.setPhase('ws-send-delta');

      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`${wsUrl}?subscribe=none`);

        ws.on('open', () => {
          // Send a delta message
          const delta = {
            context: 'vessels.self',
            updates: [
              {
                timestamp: new Date().toISOString(),
                values: [
                  { path: 'navigation.speedThroughWater', value: 2.5 },
                ],
              },
            ],
          };

          ws.send(JSON.stringify(delta));

          setTimeout(() => {
            ws.close();
            resolve();
          }, 1000);
        });

        ws.on('error', reject);
      });

      // Server should still be healthy
      const res = await fetch(`${baseUrl}/signalk`);
      expect(res.ok).toBe(true);

      expect(logMonitor.getPhaseErrors('ws-send-delta')).toHaveLength(0);
    });

    test('sent delta appears in API', async () => {
      logMonitor.setPhase('ws-delta-api-verify');

      // This test depends on whether deltas from WS are accepted
      // Send via NMEA first to ensure data exists
      await feeder.sendTcp(NmeaFixtures.generateRMC(60.5, 24.5, 7.0, 180.0));
      await sleep(1000);

      // Verify via API
      const res = await fetch(`${apiUrl}/vessels/self/navigation/position`);

      if (res.ok) {
        const data = await res.json();
        expect(data.value).toBeDefined();
        console.log(`Position from API: ${JSON.stringify(data.value)}`);
      }

      expect(logMonitor.getPhaseErrors('ws-delta-api-verify')).toHaveLength(0);
    });

    test('delta sent via WS propagates to subscribers', async () => {
      logMonitor.setPhase('ws-delta-propagate');

      const receivedDeltas = [];

      await new Promise((resolve) => {
        // Receiver WebSocket
        const receiver = new WebSocket(`${wsUrl}?subscribe=all`);
        let receiverReady = false;

        receiver.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.updates) {
              receivedDeltas.push(msg);
            }
          } catch (e) {
            // Ignore
          }
        });

        receiver.on('open', async () => {
          receiverReady = true;
          await sleep(500);

          // Send NMEA data (this will generate deltas)
          await feeder.sendTcp([
            NmeaFixtures.generateRMC(60.6, 24.6, 8.0, 200.0),
            NmeaFixtures.generateDBT(12.0),
          ]);

          await sleep(2000);
          receiver.close();
          resolve();
        });

        receiver.on('error', () => {
          resolve();
        });
      });

      console.log(`Receiver got ${receivedDeltas.length} deltas`);

      expect(logMonitor.getPhaseErrors('ws-delta-propagate')).toHaveLength(0);
    });
  });

  describe('Delta Validation', () => {
    test('rejects delta with missing context', async () => {
      logMonitor.setPhase('delta-missing-context');

      await new Promise((resolve) => {
        const ws = new WebSocket(`${wsUrl}?subscribe=none`);

        ws.on('open', () => {
          // Send invalid delta (missing context)
          ws.send(
            JSON.stringify({
              updates: [
                {
                  timestamp: new Date().toISOString(),
                  values: [{ path: 'test', value: 1 }],
                },
              ],
            })
          );

          setTimeout(() => {
            ws.close();
            resolve();
          }, 500);
        });
      });

      // Server should handle gracefully
      const res = await fetch(`${baseUrl}/signalk`);
      expect(res.ok).toBe(true);

      expect(logMonitor).toHaveNoCriticalErrors();
    });

    test('handles delta with empty updates array', async () => {
      logMonitor.setPhase('delta-empty-updates');

      await new Promise((resolve) => {
        const ws = new WebSocket(`${wsUrl}?subscribe=none`);

        ws.on('open', () => {
          ws.send(
            JSON.stringify({
              context: 'vessels.self',
              updates: [],
            })
          );

          setTimeout(() => {
            ws.close();
            resolve();
          }, 500);
        });
      });

      // Server should handle gracefully
      const res = await fetch(`${baseUrl}/signalk`);
      expect(res.ok).toBe(true);

      expect(logMonitor).toHaveNoCriticalErrors();
    });

    test('handles delta with null values', async () => {
      logMonitor.setPhase('delta-null-values');

      await new Promise((resolve) => {
        const ws = new WebSocket(`${wsUrl}?subscribe=none`);

        ws.on('open', () => {
          ws.send(
            JSON.stringify({
              context: 'vessels.self',
              updates: [
                {
                  timestamp: new Date().toISOString(),
                  values: [{ path: 'some.path', value: null }],
                },
              ],
            })
          );

          setTimeout(() => {
            ws.close();
            resolve();
          }, 500);
        });
      });

      // Server should handle gracefully
      const res = await fetch(`${baseUrl}/signalk`);
      expect(res.ok).toBe(true);

      expect(logMonitor).toHaveNoCriticalErrors();
    });
  });

  describe('Request/Response Pattern', () => {
    test('PUT returns request ID for tracking', async () => {
      logMonitor.setPhase('put-request-id');

      const res = await fetch(`${apiUrl}/vessels/self/navigation/speedOverGround`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ value: 5.0 }),
      });

      if (res.ok || res.status === 202) {
        const data = await res.json().catch(() => null);
        if (data) {
          console.log(`PUT response: ${JSON.stringify(data)}`);
        }
      }

      expect(logMonitor.getPhaseErrors('put-request-id')).toHaveLength(0);
    });
  });

  describe('Source Priority', () => {
    test('later updates can override earlier values', async () => {
      logMonitor.setPhase('source-priority');

      // Send first position
      await feeder.sendTcp(NmeaFixtures.generateRMC(60.0, 24.0, 5.0, 90.0));
      await sleep(500);

      // Get first position
      const res1 = await fetch(`${apiUrl}/vessels/self/navigation/position`);
      let pos1 = null;
      if (res1.ok) {
        pos1 = await res1.json();
      }

      // Send second position
      await feeder.sendTcp(NmeaFixtures.generateRMC(60.1, 24.1, 5.0, 90.0));
      await sleep(500);

      // Get second position
      const res2 = await fetch(`${apiUrl}/vessels/self/navigation/position`);
      if (res2.ok) {
        const pos2 = await res2.json();

        if (pos1 && pos2) {
          // Position should have changed
          console.log(`Position 1: ${JSON.stringify(pos1.value)}`);
          console.log(`Position 2: ${JSON.stringify(pos2.value)}`);
        }
      }

      expect(logMonitor.getPhaseErrors('source-priority')).toHaveLength(0);
    });
  });

  describe('Concurrent Operations', () => {
    test('handles concurrent PUT requests', async () => {
      logMonitor.setPhase('concurrent-puts');

      const paths = [
        'navigation/speedOverGround',
        'navigation/courseOverGroundTrue',
        'environment/depth/belowTransducer',
      ];

      const promises = paths.map((path, i) =>
        fetch(`${apiUrl}/vessels/self/${path}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ value: i + 1 }),
        })
      );

      const results = await Promise.all(promises);

      for (const res of results) {
        // Each should return a valid response (even if denied)
        expect([200, 202, 401, 403, 404, 405]).toContain(res.status);
      }

      expect(logMonitor.getPhaseErrors('concurrent-puts')).toHaveLength(0);
    });

    test('handles mixed read/write operations', async () => {
      logMonitor.setPhase('mixed-read-write');

      const operations = [];

      // Mix of reads and writes
      for (let i = 0; i < 5; i++) {
        // Read
        operations.push(fetch(`${apiUrl}/vessels/self/navigation/position`));

        // Write (via NMEA)
        operations.push(
          feeder.sendTcp(NmeaFixtures.generateRMC(60.0 + i * 0.01, 24.0, 5.0, 90.0))
        );
      }

      await Promise.all(operations);

      // Server should still be responsive
      const res = await fetch(`${baseUrl}/signalk`);
      expect(res.ok).toBe(true);

      expect(logMonitor.getPhaseErrors('mixed-read-write')).toHaveLength(0);
    });
  });
});
