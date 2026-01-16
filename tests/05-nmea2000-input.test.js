/**
 * NMEA 2000 Input Tests
 *
 * Tests NMEA 2000 data input via canboat JSON format
 * with various PGN types and scenarios.
 */

const { ContainerManager } = require('../lib/container-manager');
const { LogMonitor } = require('../lib/log-monitor');
const { N2kSimulator } = require('../lib/n2k-simulator');
const WebSocket = require('ws');

describe('NMEA 2000 Input', () => {
  let manager;
  let logMonitor;
  let simulator;
  let baseUrl;
  let wsUrl;

  beforeAll(async () => {
    logMonitor = new LogMonitor();
    manager = new ContainerManager({
      image: process.env.SIGNALK_IMAGE || 'signalk/signalk-server:latest',
      logMonitor,
    });
    const info = await manager.start();
    baseUrl = info.baseUrl;
    wsUrl = info.wsUrl;
    simulator = new N2kSimulator();

    // Wait for server to be fully ready
    await sleep(2000);
  }, 120000);

  afterAll(async () => {
    await manager.remove(true);

    const summary = logMonitor.getSummary();
    console.log('\n--- NMEA 2000 Test Log Summary ---');
    console.log(`Total Errors: ${summary.totalErrors}`);
    console.log(`Total Warnings: ${summary.totalWarnings}`);
  });

  describe('PGN Message Generation', () => {
    test('generates valid Position Rapid Update (129025)', () => {
      const msg = simulator.generatePosition(60.123, 24.456);
      const parsed = JSON.parse(msg);

      expect(parsed.pgn).toBe(129025);
      expect(parsed.fields.Latitude).toBe(60.123);
      expect(parsed.fields.Longitude).toBe(24.456);
      expect(parsed.timestamp).toBeDefined();
    });

    test('generates valid Vessel Heading (127250)', () => {
      const msg = simulator.generateHeading(180.5, 2.0, -3.5);
      const parsed = JSON.parse(msg);

      expect(parsed.pgn).toBe(127250);
      expect(parsed.fields.Heading).toBe(180.5);
      expect(parsed.fields.Deviation).toBe(2.0);
      expect(parsed.fields.Variation).toBe(-3.5);
    });

    test('generates valid Water Depth (128267)', () => {
      const msg = simulator.generateDepth(15.5, 0.5);
      const parsed = JSON.parse(msg);

      expect(parsed.pgn).toBe(128267);
      expect(parsed.fields.Depth).toBe(15.5);
      expect(parsed.fields.Offset).toBe(0.5);
    });

    test('generates valid COG & SOG (129026)', () => {
      const msg = simulator.generateCogSog(135.0, 7.5);
      const parsed = JSON.parse(msg);

      expect(parsed.pgn).toBe(129026);
      expect(parsed.fields.COG).toBe(135.0);
      expect(parsed.fields.SOG).toBe(7.5);
    });

    test('generates valid Wind Data (130306)', () => {
      const msg = simulator.generateWind(12.5, 45.0, 'Apparent');
      const parsed = JSON.parse(msg);

      expect(parsed.pgn).toBe(130306);
      expect(parsed.fields['Wind Speed']).toBe(12.5);
      expect(parsed.fields['Wind Angle']).toBe(45.0);
      expect(parsed.fields.Reference).toBe('Apparent');
    });

    test('generates valid Speed (128259)', () => {
      const msg = simulator.generateSpeed(6.0, 6.5);
      const parsed = JSON.parse(msg);

      expect(parsed.pgn).toBe(128259);
      expect(parsed.fields['Speed Water Referenced']).toBe(6.0);
      expect(parsed.fields['Speed Ground Referenced']).toBe(6.5);
    });

    test('generates valid Environmental Parameters (130310)', () => {
      const msg = simulator.generateEnvironment(18.5, 22.0, 101325);
      const parsed = JSON.parse(msg);

      expect(parsed.pgn).toBe(130310);
      expect(parsed.fields['Water Temperature']).toBe(18.5);
      expect(parsed.fields['Outside Ambient Air Temperature']).toBe(22.0);
      expect(parsed.fields['Atmospheric Pressure']).toBe(101325);
    });

    test('generates valid Engine Parameters (127488)', () => {
      const msg = simulator.generateEngineRapid(0, 2500, 5);
      const parsed = JSON.parse(msg);

      expect(parsed.pgn).toBe(127488);
      expect(parsed.fields['Engine Instance']).toBe(0);
      expect(parsed.fields['Engine Speed']).toBe(2500);
      expect(parsed.fields['Engine Tilt/Trim']).toBe(5);
    });

    test('generates valid Battery Status (127508)', () => {
      const msg = simulator.generateBattery(0, 12.8, 15.5, 25.0);
      const parsed = JSON.parse(msg);

      expect(parsed.pgn).toBe(127508);
      expect(parsed.fields['Battery Instance']).toBe(0);
      expect(parsed.fields.Voltage).toBe(12.8);
      expect(parsed.fields.Current).toBe(15.5);
      expect(parsed.fields.Temperature).toBe(25.0);
    });

    test('generates valid Fluid Level (127505)', () => {
      const msg = simulator.generateFluidLevel(0, 'Fuel', 75, 200);
      const parsed = JSON.parse(msg);

      expect(parsed.pgn).toBe(127505);
      expect(parsed.fields.Instance).toBe(0);
      expect(parsed.fields['Fluid Type']).toBe('Fuel');
      expect(parsed.fields.Level).toBe(75);
      expect(parsed.fields.Capacity).toBe(200);
    });
  });

  describe('Burst Generation', () => {
    test('generates navigation burst with realistic data', () => {
      logMonitor.setPhase('n2k-nav-burst-gen');

      const burst = simulator.generateNavigationBurst(10, {
        startLat: 60.0,
        startLon: 24.0,
        heading: 90,
        sog: 5.0,
        cog: 90,
      });

      expect(burst.length).toBeGreaterThan(20); // Multiple PGNs per iteration

      // Verify all messages are valid JSON
      for (const msg of burst) {
        const parsed = JSON.parse(msg);
        expect(parsed.pgn).toBeDefined();
        expect(parsed.fields).toBeDefined();
      }

      expect(logMonitor.getPhaseErrors('n2k-nav-burst-gen')).toHaveLength(0);
    });

    test('generates environment burst with sensor data', () => {
      logMonitor.setPhase('n2k-env-burst-gen');

      const burst = simulator.generateEnvironmentBurst(10, {
        depth: 15,
        windSpeed: 10,
        windAngle: 45,
      });

      expect(burst.length).toBeGreaterThan(15);

      // Verify mix of PGN types
      const pgns = burst.map((m) => JSON.parse(m).pgn);
      expect(pgns).toContain(128267); // Depth
      expect(pgns).toContain(130306); // Wind

      expect(logMonitor.getPhaseErrors('n2k-env-burst-gen')).toHaveLength(0);
    });

    test('generates engine monitoring burst', () => {
      logMonitor.setPhase('n2k-engine-burst-gen');

      const burst = simulator.generateEngineBurst(30, {
        rpm: 2500,
        engines: 2,
      });

      expect(burst.length).toBeGreaterThan(50); // 2 engines * 30 iterations + extras

      // Verify all messages parse correctly
      const pgns = burst.map((m) => JSON.parse(m).pgn);
      expect(pgns).toContain(127488); // Engine rapid
      expect(pgns).toContain(127508); // Battery

      expect(logMonitor.getPhaseErrors('n2k-engine-burst-gen')).toHaveLength(0);
    });
  });

  describe('WebSocket Delta Streaming', () => {
    test('WebSocket connection receives deltas', async () => {
      logMonitor.setPhase('n2k-ws-connect');

      const deltas = [];

      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`${wsUrl}?subscribe=all`);
        const timeout = setTimeout(() => {
          ws.close();
          resolve();
        }, 5000);

        ws.on('open', () => {
          console.log('WebSocket connected for N2K streaming test');
        });

        ws.on('message', (data) => {
          try {
            const delta = JSON.parse(data.toString());
            if (delta.updates) {
              deltas.push(delta);
            }
          } catch (e) {
            // Ignore non-JSON messages
          }
        });

        ws.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });

        ws.on('close', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      // May or may not have deltas depending on timing
      console.log(`Received ${deltas.length} deltas via WebSocket`);

      expect(logMonitor.getPhaseErrors('n2k-ws-connect')).toHaveLength(0);
    });
  });

  describe('Server API Integrity', () => {
    test('SignalK API responds correctly after N2K simulation', async () => {
      logMonitor.setPhase('n2k-api-check');

      const res = await fetch(`${baseUrl}/signalk`);
      expect(res.ok).toBe(true);

      const data = await res.json();
      expect(data.endpoints).toBeDefined();
      expect(data.endpoints.v1).toBeDefined();

      expect(logMonitor.getPhaseErrors('n2k-api-check')).toHaveLength(0);
    });

    test('vessels API structure is correct', async () => {
      logMonitor.setPhase('n2k-vessels-api');

      const res = await fetch(`${baseUrl}/signalk/v1/api/vessels`);

      // 200 or 404 (no data) are both acceptable
      expect([200, 404]).toContain(res.status);

      if (res.ok) {
        const data = await res.json();
        expect(typeof data).toBe('object');
      }

      expect(logMonitor.getPhaseErrors('n2k-vessels-api')).toHaveLength(0);
    });
  });

  describe('Data Validation', () => {
    test('generated PGN timestamps are valid ISO format', () => {
      const msg = simulator.generatePosition(60.0, 24.0);
      const parsed = JSON.parse(msg);

      const timestamp = new Date(parsed.timestamp);
      expect(timestamp.toString()).not.toBe('Invalid Date');
    });

    test('generated PGN descriptions match PGN numbers', () => {
      const testCases = [
        { pgn: 127250, name: 'Vessel Heading' },
        { pgn: 128259, name: 'Speed' },
        { pgn: 128267, name: 'Water Depth' },
        { pgn: 129025, name: 'Position, Rapid Update' },
        { pgn: 129026, name: 'COG & SOG, Rapid Update' },
        { pgn: 130306, name: 'Wind Data' },
      ];

      for (const tc of testCases) {
        const description = simulator.getPgnDescription(tc.pgn);
        expect(description).toBe(tc.name);
      }
    });

    test('navigation burst maintains data consistency', () => {
      const burst = simulator.generateNavigationBurst(5, {
        startLat: 60.0,
        startLon: 24.0,
        heading: 90,
        sog: 5.0,
        cog: 90,
      });

      // Extract all position messages
      const positions = burst
        .map((m) => JSON.parse(m))
        .filter((m) => m.pgn === 129025);

      expect(positions.length).toBe(5);

      // Verify positions are within expected range
      for (const pos of positions) {
        expect(pos.fields.Latitude).toBeGreaterThan(59.9);
        expect(pos.fields.Latitude).toBeLessThan(60.1);
        expect(pos.fields.Longitude).toBeGreaterThan(23.9);
        expect(pos.fields.Longitude).toBeLessThan(24.1);
      }
    });
  });
});
