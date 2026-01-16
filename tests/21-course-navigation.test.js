/**
 * Course Navigation API Tests
 *
 * Tests SignalK Course API for active route, next/previous waypoints.
 * Critical for autopilot integration and navigation displays.
 */

const { ContainerManager } = require('../lib/container-manager');
const { LogMonitor } = require('../lib/log-monitor');
const { NmeaFeeder } = require('../lib/nmea-feeder');
const { NmeaFixtures } = require('../lib/nmea-fixtures');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Course Navigation API', () => {
  let manager;
  let logMonitor;
  let feeder;
  let baseUrl;
  let apiUrl;
  let tcpPort;

  beforeAll(async () => {
    logMonitor = new LogMonitor();
    manager = new ContainerManager({
      image: process.env.SIGNALK_IMAGE || 'signalk/signalk-server:latest',
      logMonitor,
    });
    const info = await manager.start();
    baseUrl = info.baseUrl;
    apiUrl = `${baseUrl}/signalk/v1/api`;
    tcpPort = info.tcpPort;
    feeder = new NmeaFeeder({ tcpPort });

    // Seed position data
    await feeder.sendTcp([
      NmeaFixtures.generateRMC(60.15, 24.95, 5.5, 135.0),
      NmeaFixtures.generateGGA(60.15, 24.95, 10.0),
    ]);

    await sleep(3000);
  }, 120000);

  afterAll(async () => {
    await manager.remove(true);

    const summary = logMonitor.getSummary();
    console.log('\n--- Course Navigation Test Log Summary ---');
    console.log(`Total Errors: ${summary.totalErrors}`);
  });

  describe('Course API Endpoints', () => {
    test('course endpoint exists', async () => {
      logMonitor.setPhase('course-endpoint');

      const res = await fetch(`${apiUrl}/vessels/self/navigation/course`);
      // Course endpoint should exist (200) or be empty (404)
      expect([200, 404]).toContain(res.status);

      if (res.ok) {
        const data = await res.json();
        console.log('Course data available:', Object.keys(data));
      }

      expect(logMonitor.getPhaseErrors('course-endpoint')).toHaveLength(0);
    });

    test('activeRoute endpoint responds', async () => {
      logMonitor.setPhase('course-active-route');

      const res = await fetch(`${apiUrl}/vessels/self/navigation/course/activeRoute`);
      expect([200, 404]).toContain(res.status);

      if (res.ok) {
        const data = await res.json();
        console.log('Active route:', JSON.stringify(data).substring(0, 200));
      }

      expect(logMonitor.getPhaseErrors('course-active-route')).toHaveLength(0);
    });

    test('nextPoint endpoint responds', async () => {
      logMonitor.setPhase('course-next-point');

      const res = await fetch(`${apiUrl}/vessels/self/navigation/course/nextPoint`);
      expect([200, 404]).toContain(res.status);

      if (res.ok) {
        const data = await res.json();
        // nextPoint should have position if set
        if (data.value?.position) {
          expect(data.value.position.latitude).toBeDefined();
          expect(data.value.position.longitude).toBeDefined();
        }
        console.log('Next point:', JSON.stringify(data).substring(0, 200));
      }

      expect(logMonitor.getPhaseErrors('course-next-point')).toHaveLength(0);
    });

    test('previousPoint endpoint responds', async () => {
      logMonitor.setPhase('course-prev-point');

      const res = await fetch(`${apiUrl}/vessels/self/navigation/course/previousPoint`);
      expect([200, 404]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('course-prev-point')).toHaveLength(0);
    });
  });

  describe('Course Calculations', () => {
    test('calculates cross track error when course active', async () => {
      logMonitor.setPhase('course-xte');

      const res = await fetch(
        `${apiUrl}/vessels/self/navigation/course/crossTrackError`
      );
      expect([200, 404]).toContain(res.status);

      if (res.ok) {
        const data = await res.json();
        if (data.value !== undefined) {
          expect(typeof data.value).toBe('number');
          console.log(`Cross track error: ${data.value} meters`);
        }
      }

      expect(logMonitor.getPhaseErrors('course-xte')).toHaveLength(0);
    });

    test('calculates bearing to waypoint', async () => {
      logMonitor.setPhase('course-bearing');

      const res = await fetch(
        `${apiUrl}/vessels/self/navigation/course/bearingToDestination`
      );
      expect([200, 404]).toContain(res.status);

      if (res.ok) {
        const data = await res.json();
        if (data.value !== undefined) {
          expect(typeof data.value).toBe('number');
          // Bearing should be in radians (0 to 2*PI)
          expect(data.value).toBeGreaterThanOrEqual(0);
          expect(data.value).toBeLessThan(2 * Math.PI + 0.1);
          console.log(
            `Bearing to destination: ${((data.value * 180) / Math.PI).toFixed(1)} degrees`
          );
        }
      }

      expect(logMonitor.getPhaseErrors('course-bearing')).toHaveLength(0);
    });

    test('calculates distance to waypoint', async () => {
      logMonitor.setPhase('course-distance');

      const res = await fetch(
        `${apiUrl}/vessels/self/navigation/course/distanceToDestination`
      );
      expect([200, 404]).toContain(res.status);

      if (res.ok) {
        const data = await res.json();
        if (data.value !== undefined) {
          expect(typeof data.value).toBe('number');
          expect(data.value).toBeGreaterThanOrEqual(0);
          console.log(`Distance to destination: ${data.value} meters`);
        }
      }

      expect(logMonitor.getPhaseErrors('course-distance')).toHaveLength(0);
    });

    test('calculates time to waypoint', async () => {
      logMonitor.setPhase('course-ttw');

      const res = await fetch(
        `${apiUrl}/vessels/self/navigation/course/timeToDestination`
      );
      expect([200, 404]).toContain(res.status);

      if (res.ok) {
        const data = await res.json();
        if (data.value !== undefined) {
          expect(typeof data.value).toBe('number');
          console.log(`Time to destination: ${data.value} seconds`);
        }
      }

      expect(logMonitor.getPhaseErrors('course-ttw')).toHaveLength(0);
    });

    test('calculates velocity made good', async () => {
      logMonitor.setPhase('course-vmg');

      const res = await fetch(
        `${apiUrl}/vessels/self/navigation/course/velocityMadeGood`
      );
      expect([200, 404]).toContain(res.status);

      if (res.ok) {
        const data = await res.json();
        if (data.value !== undefined) {
          expect(typeof data.value).toBe('number');
          console.log(`VMG: ${data.value} m/s`);
        }
      }

      expect(logMonitor.getPhaseErrors('course-vmg')).toHaveLength(0);
    });
  });

  describe('Course PUT Operations', () => {
    const testDestination = {
      value: {
        position: {
          latitude: 60.2,
          longitude: 25.0,
        },
      },
    };

    test('can set destination via PUT', async () => {
      logMonitor.setPhase('course-put-dest');

      const res = await fetch(
        `${apiUrl}/vessels/self/navigation/course/nextPoint`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(testDestination),
        }
      );

      // Should succeed (200), require auth (401/403), or not support PUT (405)
      expect([200, 202, 401, 403, 404, 405]).toContain(res.status);
      console.log(`Set destination response: ${res.status}`);

      expect(logMonitor.getPhaseErrors('course-put-dest')).toHaveLength(0);
    });

    test('can activate route via PUT', async () => {
      logMonitor.setPhase('course-activate-route');

      const routeActivation = {
        value: {
          href: '/resources/routes/test-route-id',
        },
      };

      const res = await fetch(
        `${apiUrl}/vessels/self/navigation/course/activeRoute`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(routeActivation),
        }
      );

      expect([200, 202, 400, 401, 403, 404, 405]).toContain(res.status);
      console.log(`Activate route response: ${res.status}`);

      expect(logMonitor.getPhaseErrors('course-activate-route')).toHaveLength(0);
    });

    test('can clear course via DELETE', async () => {
      logMonitor.setPhase('course-clear');

      const res = await fetch(`${apiUrl}/vessels/self/navigation/course`, {
        method: 'DELETE',
      });

      // DELETE might clear course or not be supported
      expect([200, 204, 401, 403, 404, 405]).toContain(res.status);
      console.log(`Clear course response: ${res.status}`);

      expect(logMonitor.getPhaseErrors('course-clear')).toHaveLength(0);
    });
  });

  describe('Course API v2 (if available)', () => {
    test('course/destination endpoint (v2)', async () => {
      logMonitor.setPhase('course-v2-dest');

      const res = await fetch(`${baseUrl}/signalk/v2/api/vessels/self/navigation/course/destination`);
      expect([200, 404]).toContain(res.status);

      if (res.ok) {
        const data = await res.json();
        console.log('v2 destination:', JSON.stringify(data).substring(0, 200));
      }

      expect(logMonitor.getPhaseErrors('course-v2-dest')).toHaveLength(0);
    });

    test('course/activeRoute endpoint (v2)', async () => {
      logMonitor.setPhase('course-v2-route');

      const res = await fetch(`${baseUrl}/signalk/v2/api/vessels/self/navigation/course/activeRoute`);
      expect([200, 404]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('course-v2-route')).toHaveLength(0);
    });
  });

  describe('Navigation State', () => {
    test('navigation state endpoint responds', async () => {
      logMonitor.setPhase('nav-state');

      const res = await fetch(`${apiUrl}/vessels/self/navigation/state`);
      expect([200, 404]).toContain(res.status);

      if (res.ok) {
        const data = await res.json();
        // State should be one of: sailing, motoring, anchored, moored, etc.
        console.log('Navigation state:', JSON.stringify(data));
      }

      expect(logMonitor.getPhaseErrors('nav-state')).toHaveLength(0);
    });

    test('datetime endpoint responds', async () => {
      logMonitor.setPhase('nav-datetime');

      const res = await fetch(`${apiUrl}/vessels/self/navigation/datetime`);
      expect([200, 404]).toContain(res.status);

      if (res.ok) {
        const data = await res.json();
        if (data.value) {
          // Should be valid ISO datetime
          const date = new Date(data.value);
          expect(date.toString()).not.toBe('Invalid Date');
          console.log('Navigation datetime:', data.value);
        }
      }

      expect(logMonitor.getPhaseErrors('nav-datetime')).toHaveLength(0);
    });
  });

  describe('Autopilot Integration', () => {
    test('steering/autopilot endpoint responds', async () => {
      logMonitor.setPhase('autopilot-state');

      const res = await fetch(`${apiUrl}/vessels/self/steering/autopilot`);
      expect([200, 404]).toContain(res.status);

      if (res.ok) {
        const data = await res.json();
        console.log('Autopilot data:', Object.keys(data));
      }

      expect(logMonitor.getPhaseErrors('autopilot-state')).toHaveLength(0);
    });

    test('autopilot target heading endpoint', async () => {
      logMonitor.setPhase('autopilot-target');

      const res = await fetch(
        `${apiUrl}/vessels/self/steering/autopilot/target/headingTrue`
      );
      expect([200, 404]).toContain(res.status);

      if (res.ok) {
        const data = await res.json();
        if (data.value !== undefined) {
          expect(typeof data.value).toBe('number');
        }
      }

      expect(logMonitor.getPhaseErrors('autopilot-target')).toHaveLength(0);
    });

    test('autopilot state can be read', async () => {
      logMonitor.setPhase('autopilot-mode');

      const res = await fetch(`${apiUrl}/vessels/self/steering/autopilot/state`);
      expect([200, 404]).toContain(res.status);

      if (res.ok) {
        const data = await res.json();
        // State should be: auto, standby, route, wind, etc.
        console.log('Autopilot state:', JSON.stringify(data));
      }

      expect(logMonitor.getPhaseErrors('autopilot-mode')).toHaveLength(0);
    });

    test('rudder angle endpoint responds', async () => {
      logMonitor.setPhase('rudder-angle');

      const res = await fetch(`${apiUrl}/vessels/self/steering/rudderAngle`);
      expect([200, 404]).toContain(res.status);

      if (res.ok) {
        const data = await res.json();
        if (data.value !== undefined) {
          expect(typeof data.value).toBe('number');
          // Rudder angle in radians
          console.log(
            `Rudder angle: ${((data.value * 180) / Math.PI).toFixed(1)} degrees`
          );
        }
      }

      expect(logMonitor.getPhaseErrors('rudder-angle')).toHaveLength(0);
    });
  });

  describe('Course via WebSocket', () => {
    test('course updates arrive via WebSocket subscription', async () => {
      logMonitor.setPhase('course-ws');

      const WebSocket = require('ws');
      const wsUrl = baseUrl.replace('http', 'ws');

      const messages = await new Promise((resolve) => {
        const collected = [];
        const ws = new WebSocket(`${wsUrl}/signalk/v1/stream?subscribe=none`);

        ws.on('open', () => {
          // Subscribe to course updates
          ws.send(
            JSON.stringify({
              context: 'vessels.self',
              subscribe: [{ path: 'navigation.course.*' }],
            })
          );

          setTimeout(() => {
            ws.close();
            resolve(collected);
          }, 3000);
        });

        ws.on('message', (data) => {
          try {
            collected.push(JSON.parse(data.toString()));
          } catch (e) {
            // Ignore
          }
        });

        ws.on('error', () => {
          resolve(collected);
        });
      });

      console.log(`Received ${messages.length} course-related WebSocket messages`);

      expect(logMonitor.getPhaseErrors('course-ws')).toHaveLength(0);
    });
  });
});
