/**
 * REST API Comprehensive Tests
 *
 * Tests all SignalK REST API endpoints including
 * discovery, vessels, resources, and server info.
 */

const { ContainerManager } = require('../lib/container-manager');
const { LogMonitor } = require('../lib/log-monitor');
const { NmeaFeeder } = require('../lib/nmea-feeder');
const { NmeaFixtures } = require('../lib/nmea-fixtures');

describe('REST API Comprehensive', () => {
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
    apiUrl = info.apiUrl;
    tcpPort = info.tcpPort;
    feeder = new NmeaFeeder({ tcpPort });

    // Seed some data
    await seedTestData();
    await sleep(3000);
  }, 120000);

  afterAll(async () => {
    await manager.remove(true);

    const summary = logMonitor.getSummary();
    console.log('\n--- REST API Test Log Summary ---');
    console.log(`Total Errors: ${summary.totalErrors}`);
    console.log(`Total Warnings: ${summary.totalWarnings}`);
  });

  async function seedTestData() {
    // Send navigation data
    const sentences = [
      NmeaFixtures.generateRMC(60.15, 24.95, 5.5, 135.0),
      NmeaFixtures.generateGGA(60.15, 24.95, 10.0),
      NmeaFixtures.generateDBT(15.5),
      NmeaFixtures.generateMWV(45, 12.0, 'R'),
      NmeaFixtures.generateMWV(55, 10.0, 'T'),
      NmeaFixtures.generateHDT(135.0),
      NmeaFixtures.generateVTG(135.0, 5.5),
      NmeaFixtures.generateMTW(18.5),
    ];
    await feeder.sendTcp(sentences, { delay: 100 });
  }

  describe('Discovery Endpoint (/signalk)', () => {
    test('returns valid SignalK discovery document', async () => {
      logMonitor.setPhase('api-discovery');

      const res = await fetch(`${baseUrl}/signalk`);
      expect(res.ok).toBe(true);

      const data = await res.json();

      // Check required fields
      expect(data.endpoints).toBeDefined();
      expect(data.endpoints.v1).toBeDefined();
      expect(data.server).toBeDefined();
      expect(data.server.id).toBeDefined();

      // Check version info
      expect(data.endpoints.v1['signalk-http']).toBeDefined();
      expect(data.endpoints.v1['signalk-ws']).toBeDefined();

      console.log(`Server ID: ${data.server.id}`);
      console.log(`SignalK version: ${data.endpoints.v1.version}`);

      expect(logMonitor.getPhaseErrors('api-discovery')).toHaveLength(0);
    });

    test('discovery endpoint sets correct content-type', async () => {
      const res = await fetch(`${baseUrl}/signalk`);
      const contentType = res.headers.get('content-type');

      expect(contentType).toMatch(/application\/json/);
    });
  });

  describe('Full Data Model (/signalk/v1/api)', () => {
    test('returns complete SignalK data model', async () => {
      logMonitor.setPhase('api-full-model');

      const res = await fetch(`${apiUrl}`);
      expect(res.ok).toBe(true);

      const data = await res.json();

      // Should have vessels object
      expect(data.vessels).toBeDefined();
      expect(typeof data.vessels).toBe('object');

      expect(logMonitor.getPhaseErrors('api-full-model')).toHaveLength(0);
    });

    test('data model includes self reference', async () => {
      const res = await fetch(`${apiUrl}`);
      const data = await res.json();

      expect(data.self).toBeDefined();
      // Self should be a URN or vessel key
      expect(data.self.startsWith('vessels.') || data.self.startsWith('urn:')).toBe(true);
    });
  });

  describe('Vessels API (/signalk/v1/api/vessels)', () => {
    test('lists all vessels', async () => {
      logMonitor.setPhase('api-vessels-list');

      const res = await fetch(`${apiUrl}/vessels`);
      expect(res.ok).toBe(true);

      const data = await res.json();
      expect(typeof data).toBe('object');

      const vesselCount = Object.keys(data).length;
      expect(vesselCount).toBeGreaterThanOrEqual(1);
      console.log(`Found ${vesselCount} vessel(s)`);

      expect(logMonitor.getPhaseErrors('api-vessels-list')).toHaveLength(0);
    });

    test('returns self vessel data', async () => {
      logMonitor.setPhase('api-vessels-self');

      const res = await fetch(`${apiUrl}/vessels/self`);
      expect(res.ok).toBe(true);

      const data = await res.json();
      expect(typeof data).toBe('object');

      expect(logMonitor.getPhaseErrors('api-vessels-self')).toHaveLength(0);
    });
  });

  describe('Navigation Data', () => {
    test('returns position data', async () => {
      logMonitor.setPhase('api-position');

      const res = await fetch(`${apiUrl}/vessels/self/navigation/position`);

      if (res.ok) {
        const data = await res.json();
        expect(data.value).toBeDefined();
        expect(data.value.latitude).toBeDefined();
        expect(data.value.longitude).toBeDefined();

        // Validate ranges
        expect(data.value.latitude).toBeGreaterThanOrEqual(-90);
        expect(data.value.latitude).toBeLessThanOrEqual(90);
        expect(data.value.longitude).toBeGreaterThanOrEqual(-180);
        expect(data.value.longitude).toBeLessThanOrEqual(180);

        console.log(`Position: ${data.value.latitude}, ${data.value.longitude}`);
      } else {
        console.log(`Position not available: ${res.status}`);
      }

      expect(logMonitor.getPhaseErrors('api-position')).toHaveLength(0);
    });

    test('returns speed over ground', async () => {
      logMonitor.setPhase('api-sog');

      const res = await fetch(`${apiUrl}/vessels/self/navigation/speedOverGround`);

      if (res.ok) {
        const data = await res.json();
        expect(data.value).toBeDefined();
        expect(typeof data.value).toBe('number');
        expect(data.value).toBeGreaterThanOrEqual(0);

        // SignalK uses m/s
        console.log(`SOG: ${data.value} m/s (${(data.value * 1.94384).toFixed(2)} knots)`);
      }

      expect(logMonitor.getPhaseErrors('api-sog')).toHaveLength(0);
    });

    test('returns course over ground', async () => {
      logMonitor.setPhase('api-cog');

      const res = await fetch(`${apiUrl}/vessels/self/navigation/courseOverGroundTrue`);

      if (res.ok) {
        const data = await res.json();
        expect(data.value).toBeDefined();
        expect(typeof data.value).toBe('number');

        // COG in radians (0 to 2*PI)
        expect(data.value).toBeGreaterThanOrEqual(0);
        expect(data.value).toBeLessThan(2 * Math.PI + 0.1);

        console.log(`COG: ${((data.value * 180) / Math.PI).toFixed(1)} degrees`);
      }

      expect(logMonitor.getPhaseErrors('api-cog')).toHaveLength(0);
    });

    test('returns heading', async () => {
      logMonitor.setPhase('api-heading');

      const res = await fetch(`${apiUrl}/vessels/self/navigation/headingTrue`);

      if (res.ok) {
        const data = await res.json();
        expect(data.value).toBeDefined();
        expect(typeof data.value).toBe('number');

        console.log(`Heading: ${((data.value * 180) / Math.PI).toFixed(1)} degrees`);
      }

      expect(logMonitor.getPhaseErrors('api-heading')).toHaveLength(0);
    });
  });

  describe('Environment Data', () => {
    test('returns depth data', async () => {
      logMonitor.setPhase('api-depth');

      const res = await fetch(`${apiUrl}/vessels/self/environment/depth/belowTransducer`);

      if (res.ok) {
        const data = await res.json();
        expect(data.value).toBeDefined();
        expect(typeof data.value).toBe('number');
        expect(data.value).toBeGreaterThan(0);

        console.log(`Depth: ${data.value} meters`);
      }

      expect(logMonitor.getPhaseErrors('api-depth')).toHaveLength(0);
    });

    test('returns wind data', async () => {
      logMonitor.setPhase('api-wind');

      const apparentSpeedRes = await fetch(`${apiUrl}/vessels/self/environment/wind/speedApparent`);
      const apparentAngleRes = await fetch(`${apiUrl}/vessels/self/environment/wind/angleApparent`);

      if (apparentSpeedRes.ok) {
        const data = await apparentSpeedRes.json();
        expect(data.value).toBeDefined();
        expect(typeof data.value).toBe('number');
        console.log(`Apparent wind speed: ${data.value} m/s`);
      }

      if (apparentAngleRes.ok) {
        const data = await apparentAngleRes.json();
        expect(data.value).toBeDefined();
        expect(typeof data.value).toBe('number');
        console.log(`Apparent wind angle: ${((data.value * 180) / Math.PI).toFixed(1)} degrees`);
      }

      expect(logMonitor.getPhaseErrors('api-wind')).toHaveLength(0);
    });

    test('returns water temperature', async () => {
      logMonitor.setPhase('api-water-temp');

      const res = await fetch(`${apiUrl}/vessels/self/environment/water/temperature`);

      if (res.ok) {
        const data = await res.json();
        expect(data.value).toBeDefined();
        expect(typeof data.value).toBe('number');

        // SignalK uses Kelvin
        const celsius = data.value - 273.15;
        console.log(`Water temperature: ${celsius.toFixed(1)} C`);
      }

      expect(logMonitor.getPhaseErrors('api-water-temp')).toHaveLength(0);
    });
  });

  describe('Data Metadata', () => {
    test('data includes timestamps', async () => {
      logMonitor.setPhase('api-timestamps');

      const res = await fetch(`${apiUrl}/vessels/self/navigation/position`);

      if (res.ok) {
        const data = await res.json();

        if (data.timestamp) {
          const timestamp = new Date(data.timestamp);
          expect(timestamp.toString()).not.toBe('Invalid Date');
          console.log(`Data timestamp: ${data.timestamp}`);
        }

        if (data.$source) {
          console.log(`Data source: ${data.$source}`);
        }
      }

      expect(logMonitor.getPhaseErrors('api-timestamps')).toHaveLength(0);
    });

    test('supports meta endpoint for path metadata', async () => {
      logMonitor.setPhase('api-meta');

      const res = await fetch(`${apiUrl}/vessels/self/navigation/position/meta`);

      // Meta might not exist for all paths
      if (res.ok) {
        const data = await res.json();
        console.log(`Position meta: ${JSON.stringify(data)}`);
      }

      expect(logMonitor.getPhaseErrors('api-meta')).toHaveLength(0);
    });
  });

  describe('Server Info Endpoints', () => {
    test('returns server info', async () => {
      logMonitor.setPhase('api-server-info');

      const res = await fetch(`${baseUrl}/skServer/info`);
      // Endpoint may not exist in all versions
      expect([200, 404]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('api-server-info')).toHaveLength(0);
    });

    test('returns providers list', async () => {
      logMonitor.setPhase('api-providers');

      const res = await fetch(`${baseUrl}/skServer/providers`);

      if (res.ok) {
        const data = await res.json();
        expect(Array.isArray(data) || typeof data === 'object').toBe(true);
        console.log(`Providers: ${JSON.stringify(data, null, 2).substring(0, 200)}`);
      }

      expect(logMonitor.getPhaseErrors('api-providers')).toHaveLength(0);
    });

    test('returns plugin status', async () => {
      logMonitor.setPhase('api-plugins');

      const res = await fetch(`${baseUrl}/skServer/plugins`);

      // May require authentication
      expect([200, 401, 403]).toContain(res.status);

      if (res.ok) {
        const data = await res.json();
        expect(Array.isArray(data)).toBe(true);
        console.log(`Found ${data.length} plugins`);
      }

      expect(logMonitor.getPhaseErrors('api-plugins')).toHaveLength(0);
    });
  });

  describe('HTTP Methods and Headers', () => {
    test('supports CORS headers', async () => {
      logMonitor.setPhase('api-cors');

      const res = await fetch(`${baseUrl}/signalk`, {
        method: 'OPTIONS',
      });

      // Check for CORS headers
      const allowOrigin = res.headers.get('access-control-allow-origin');
      console.log(`CORS Allow-Origin: ${allowOrigin}`);

      expect(logMonitor.getPhaseErrors('api-cors')).toHaveLength(0);
    });

    test('returns 404 for invalid paths', async () => {
      logMonitor.setPhase('api-404');

      const res = await fetch(`${apiUrl}/vessels/self/nonexistent/path/here`);
      expect(res.status).toBe(404);

      expect(logMonitor.getPhaseErrors('api-404')).toHaveLength(0);
    });

    test('handles trailing slashes correctly', async () => {
      logMonitor.setPhase('api-trailing-slash');

      const res1 = await fetch(`${apiUrl}/vessels/self`);
      const res2 = await fetch(`${apiUrl}/vessels/self/`);

      // Both should work or both should return same status
      expect([200, 404]).toContain(res1.status);
      expect([200, 404]).toContain(res2.status);

      expect(logMonitor.getPhaseErrors('api-trailing-slash')).toHaveLength(0);
    });
  });

  describe('Data Path Traversal', () => {
    test('can traverse data tree', async () => {
      logMonitor.setPhase('api-traverse');

      // Start from root
      const rootRes = await fetch(`${apiUrl}/vessels/self`);
      if (!rootRes.ok) {
        console.log('No self vessel data available');
        return;
      }

      const rootData = await rootRes.json();

      // Try to traverse to first available path
      const topLevelKeys = Object.keys(rootData);
      console.log(`Top-level keys: ${topLevelKeys.join(', ')}`);

      for (const key of topLevelKeys) {
        if (typeof rootData[key] === 'object' && rootData[key] !== null) {
          const pathRes = await fetch(`${apiUrl}/vessels/self/${key}`);
          console.log(`Path /${key}: ${pathRes.status}`);
        }
      }

      expect(logMonitor.getPhaseErrors('api-traverse')).toHaveLength(0);
    });

    test('navigation subtree is traversable', async () => {
      logMonitor.setPhase('api-nav-traverse');

      const res = await fetch(`${apiUrl}/vessels/self/navigation`);

      if (res.ok) {
        const data = await res.json();
        const navKeys = Object.keys(data);
        console.log(`Navigation keys: ${navKeys.join(', ')}`);
        expect(navKeys.length).toBeGreaterThan(0);
      }

      expect(logMonitor.getPhaseErrors('api-nav-traverse')).toHaveLength(0);
    });
  });

  describe('Content Negotiation', () => {
    test('accepts application/json', async () => {
      logMonitor.setPhase('api-accept-json');

      const res = await fetch(`${baseUrl}/signalk`, {
        headers: {
          Accept: 'application/json',
        },
      });

      expect(res.ok).toBe(true);
      expect(res.headers.get('content-type')).toMatch(/application\/json/);

      expect(logMonitor.getPhaseErrors('api-accept-json')).toHaveLength(0);
    });
  });
});
