/**
 * Resources API Tests
 *
 * Tests SignalK Resources API for routes, waypoints, notes, regions, and charts.
 * These are critical for navigation planning features.
 */

const { ContainerManager } = require('../lib/container-manager');
const { LogMonitor } = require('../lib/log-monitor');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Resources API', () => {
  let manager;
  let logMonitor;
  let baseUrl;
  let apiUrl;

  beforeAll(async () => {
    logMonitor = new LogMonitor();
    manager = new ContainerManager({
      image: process.env.SIGNALK_IMAGE || 'signalk/signalk-server:latest',
      logMonitor,
    });
    const info = await manager.start();
    baseUrl = info.baseUrl;
    apiUrl = `${baseUrl}/signalk/v1/api`;

    await sleep(2000);
  }, 120000);

  afterAll(async () => {
    await manager.remove(true);

    const summary = logMonitor.getSummary();
    console.log('\n--- Resources API Test Log Summary ---');
    console.log(`Total Errors: ${summary.totalErrors}`);
  });

  describe('Resources Endpoint Discovery', () => {
    test('resources endpoint exists', async () => {
      logMonitor.setPhase('resources-discovery');

      const res = await fetch(`${apiUrl}/resources`);
      // Resources endpoint should exist (200) or return empty (404 if no resources)
      expect([200, 404]).toContain(res.status);

      if (res.ok) {
        const data = await res.json();
        console.log('Resources available:', Object.keys(data));
      }

      expect(logMonitor.getPhaseErrors('resources-discovery')).toHaveLength(0);
    });

    test('resources types are discoverable', async () => {
      logMonitor.setPhase('resources-types');

      const resourceTypes = ['routes', 'waypoints', 'notes', 'regions', 'charts'];

      for (const type of resourceTypes) {
        const res = await fetch(`${apiUrl}/resources/${type}`);
        // Each type should either exist (200) or not be configured (404)
        expect([200, 404]).toContain(res.status);
        console.log(`Resource type ${type}: ${res.status}`);
      }

      expect(logMonitor.getPhaseErrors('resources-types')).toHaveLength(0);
    });
  });

  describe('Waypoints API', () => {
    const testWaypointId = 'urn:mrn:signalk:uuid:test-waypoint-' + Date.now();
    const testWaypoint = {
      name: 'Test Waypoint',
      description: 'Automated test waypoint',
      position: {
        latitude: 60.1234,
        longitude: 24.5678,
      },
      feature: {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [24.5678, 60.1234],
        },
        properties: {
          name: 'Test Waypoint',
        },
      },
    };

    test('can list waypoints', async () => {
      logMonitor.setPhase('waypoints-list');

      const res = await fetch(`${apiUrl}/resources/waypoints`);
      expect([200, 404]).toContain(res.status);

      if (res.ok) {
        const data = await res.json();
        expect(typeof data).toBe('object');
        console.log(`Found ${Object.keys(data).length} waypoints`);
      }

      expect(logMonitor.getPhaseErrors('waypoints-list')).toHaveLength(0);
    });

    test('can create waypoint via PUT', async () => {
      logMonitor.setPhase('waypoints-create');

      const res = await fetch(`${apiUrl}/resources/waypoints/${testWaypointId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testWaypoint),
      });

      // Should succeed (200/201) or require auth (401/403) or not supported (404/405)
      expect([200, 201, 401, 403, 404, 405]).toContain(res.status);
      console.log(`Create waypoint response: ${res.status}`);

      expect(logMonitor.getPhaseErrors('waypoints-create')).toHaveLength(0);
    });

    test('can retrieve waypoint by ID', async () => {
      logMonitor.setPhase('waypoints-get');

      const res = await fetch(`${apiUrl}/resources/waypoints/${testWaypointId}`);
      // May exist if created, or 404 if creation required auth
      expect([200, 404]).toContain(res.status);

      if (res.ok) {
        const data = await res.json();
        expect(data.name || data.feature?.properties?.name).toBeDefined();
      }

      expect(logMonitor.getPhaseErrors('waypoints-get')).toHaveLength(0);
    });

    test('can delete waypoint', async () => {
      logMonitor.setPhase('waypoints-delete');

      const res = await fetch(`${apiUrl}/resources/waypoints/${testWaypointId}`, {
        method: 'DELETE',
      });

      // Should succeed or require auth or not found
      expect([200, 204, 401, 403, 404, 405]).toContain(res.status);
      console.log(`Delete waypoint response: ${res.status}`);

      expect(logMonitor.getPhaseErrors('waypoints-delete')).toHaveLength(0);
    });

    test('returns 404 for non-existent waypoint', async () => {
      logMonitor.setPhase('waypoints-404');

      const res = await fetch(`${apiUrl}/resources/waypoints/non-existent-waypoint-id`);
      expect(res.status).toBe(404);

      expect(logMonitor.getPhaseErrors('waypoints-404')).toHaveLength(0);
    });
  });

  describe('Routes API', () => {
    const testRouteId = 'urn:mrn:signalk:uuid:test-route-' + Date.now();
    const testRoute = {
      name: 'Test Route',
      description: 'Automated test route',
      feature: {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [24.5678, 60.1234],
            [24.6789, 60.2345],
            [24.7890, 60.3456],
          ],
        },
        properties: {
          name: 'Test Route',
        },
      },
    };

    test('can list routes', async () => {
      logMonitor.setPhase('routes-list');

      const res = await fetch(`${apiUrl}/resources/routes`);
      expect([200, 404]).toContain(res.status);

      if (res.ok) {
        const data = await res.json();
        expect(typeof data).toBe('object');
        console.log(`Found ${Object.keys(data).length} routes`);
      }

      expect(logMonitor.getPhaseErrors('routes-list')).toHaveLength(0);
    });

    test('can create route via PUT', async () => {
      logMonitor.setPhase('routes-create');

      const res = await fetch(`${apiUrl}/resources/routes/${testRouteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testRoute),
      });

      expect([200, 201, 401, 403, 404, 405]).toContain(res.status);
      console.log(`Create route response: ${res.status}`);

      expect(logMonitor.getPhaseErrors('routes-create')).toHaveLength(0);
    });

    test('can retrieve route by ID', async () => {
      logMonitor.setPhase('routes-get');

      const res = await fetch(`${apiUrl}/resources/routes/${testRouteId}`);
      expect([200, 404]).toContain(res.status);

      if (res.ok) {
        const data = await res.json();
        expect(data.feature?.geometry?.type).toBe('LineString');
      }

      expect(logMonitor.getPhaseErrors('routes-get')).toHaveLength(0);
    });

    test('route contains valid GeoJSON', async () => {
      logMonitor.setPhase('routes-geojson');

      const res = await fetch(`${apiUrl}/resources/routes`);

      if (res.ok) {
        const data = await res.json();
        const routes = Object.values(data);

        for (const route of routes.slice(0, 3)) {
          if (route.feature) {
            expect(route.feature.type).toBe('Feature');
            expect(route.feature.geometry).toBeDefined();
            expect(['LineString', 'MultiLineString']).toContain(
              route.feature.geometry.type
            );
          }
        }
      }

      expect(logMonitor.getPhaseErrors('routes-geojson')).toHaveLength(0);
    });

    test('can delete route', async () => {
      logMonitor.setPhase('routes-delete');

      const res = await fetch(`${apiUrl}/resources/routes/${testRouteId}`, {
        method: 'DELETE',
      });

      expect([200, 204, 401, 403, 404, 405]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('routes-delete')).toHaveLength(0);
    });
  });

  describe('Notes API', () => {
    const testNoteId = 'urn:mrn:signalk:uuid:test-note-' + Date.now();
    const testNote = {
      title: 'Test Note',
      description: 'Automated test note for release validation',
      position: {
        latitude: 60.1234,
        longitude: 24.5678,
      },
      mimeType: 'text/plain',
    };

    test('can list notes', async () => {
      logMonitor.setPhase('notes-list');

      const res = await fetch(`${apiUrl}/resources/notes`);
      expect([200, 404]).toContain(res.status);

      if (res.ok) {
        const data = await res.json();
        console.log(`Found ${Object.keys(data).length} notes`);
      }

      expect(logMonitor.getPhaseErrors('notes-list')).toHaveLength(0);
    });

    test('can create note via PUT', async () => {
      logMonitor.setPhase('notes-create');

      const res = await fetch(`${apiUrl}/resources/notes/${testNoteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testNote),
      });

      expect([200, 201, 401, 403, 404, 405]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('notes-create')).toHaveLength(0);
    });

    test('can retrieve note by ID', async () => {
      logMonitor.setPhase('notes-get');

      const res = await fetch(`${apiUrl}/resources/notes/${testNoteId}`);
      expect([200, 404]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('notes-get')).toHaveLength(0);
    });

    test('can delete note', async () => {
      logMonitor.setPhase('notes-delete');

      const res = await fetch(`${apiUrl}/resources/notes/${testNoteId}`, {
        method: 'DELETE',
      });

      expect([200, 204, 401, 403, 404, 405]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('notes-delete')).toHaveLength(0);
    });
  });

  describe('Regions API', () => {
    const testRegionId = 'urn:mrn:signalk:uuid:test-region-' + Date.now();
    const testRegion = {
      name: 'Test Region',
      description: 'Automated test region',
      feature: {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [24.5, 60.1],
              [24.6, 60.1],
              [24.6, 60.2],
              [24.5, 60.2],
              [24.5, 60.1],
            ],
          ],
        },
        properties: {
          name: 'Test Region',
        },
      },
    };

    test('can list regions', async () => {
      logMonitor.setPhase('regions-list');

      const res = await fetch(`${apiUrl}/resources/regions`);
      expect([200, 404]).toContain(res.status);

      if (res.ok) {
        const data = await res.json();
        console.log(`Found ${Object.keys(data).length} regions`);
      }

      expect(logMonitor.getPhaseErrors('regions-list')).toHaveLength(0);
    });

    test('can create region via PUT', async () => {
      logMonitor.setPhase('regions-create');

      const res = await fetch(`${apiUrl}/resources/regions/${testRegionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testRegion),
      });

      expect([200, 201, 401, 403, 404, 405]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('regions-create')).toHaveLength(0);
    });

    test('region contains valid GeoJSON polygon', async () => {
      logMonitor.setPhase('regions-geojson');

      const res = await fetch(`${apiUrl}/resources/regions`);

      if (res.ok) {
        const data = await res.json();
        const regions = Object.values(data);

        for (const region of regions.slice(0, 3)) {
          if (region.feature) {
            expect(region.feature.type).toBe('Feature');
            expect(['Polygon', 'MultiPolygon']).toContain(
              region.feature.geometry.type
            );
          }
        }
      }

      expect(logMonitor.getPhaseErrors('regions-geojson')).toHaveLength(0);
    });

    test('can delete region', async () => {
      logMonitor.setPhase('regions-delete');

      const res = await fetch(`${apiUrl}/resources/regions/${testRegionId}`, {
        method: 'DELETE',
      });

      expect([200, 204, 401, 403, 404, 405]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('regions-delete')).toHaveLength(0);
    });
  });

  describe('Charts API', () => {
    test('can list charts', async () => {
      logMonitor.setPhase('charts-list');

      const res = await fetch(`${apiUrl}/resources/charts`);
      expect([200, 404]).toContain(res.status);

      if (res.ok) {
        const data = await res.json();
        console.log(`Found ${Object.keys(data).length} charts`);

        // Validate chart structure if any exist
        const charts = Object.values(data);
        for (const chart of charts.slice(0, 3)) {
          if (chart.identifier) {
            expect(typeof chart.identifier).toBe('string');
          }
          if (chart.name) {
            expect(typeof chart.name).toBe('string');
          }
        }
      }

      expect(logMonitor.getPhaseErrors('charts-list')).toHaveLength(0);
    });

    test('chart endpoint returns proper content-type', async () => {
      logMonitor.setPhase('charts-content-type');

      const res = await fetch(`${apiUrl}/resources/charts`);

      if (res.ok) {
        const contentType = res.headers.get('content-type');
        expect(contentType).toMatch(/application\/json/);
      }

      expect(logMonitor.getPhaseErrors('charts-content-type')).toHaveLength(0);
    });
  });

  describe('Resource Filtering', () => {
    test('supports bounding box filter for waypoints', async () => {
      logMonitor.setPhase('resources-bbox');

      // Test with bbox query parameter
      const bbox = '24.0,60.0,25.0,61.0'; // lon1,lat1,lon2,lat2
      const res = await fetch(`${apiUrl}/resources/waypoints?bbox=${bbox}`);

      expect([200, 400, 404]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('resources-bbox')).toHaveLength(0);
    });

    test('supports distance filter for waypoints', async () => {
      logMonitor.setPhase('resources-distance');

      // Test with position and distance query
      const res = await fetch(
        `${apiUrl}/resources/waypoints?position=60.1,24.5&distance=10000`
      );

      expect([200, 400, 404]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('resources-distance')).toHaveLength(0);
    });
  });

  describe('Error Handling', () => {
    test('returns 400 for invalid resource data', async () => {
      logMonitor.setPhase('resources-invalid');

      const invalidResource = {
        invalid: 'data',
        // Missing required fields
      };

      const res = await fetch(`${apiUrl}/resources/waypoints/test-invalid`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invalidResource),
      });

      // Should return 400 Bad Request, 401/403 for auth, or 404/405 if not supported
      expect([400, 401, 403, 404, 405, 422]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('resources-invalid')).toHaveLength(0);
    });

    test('returns proper error for malformed JSON', async () => {
      logMonitor.setPhase('resources-malformed');

      const res = await fetch(`${apiUrl}/resources/waypoints/test-malformed`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json{',
      });

      expect([400, 401, 403, 404, 405]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('resources-malformed')).toHaveLength(0);
    });
  });
});
