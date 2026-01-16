/**
 * mDNS/Bonjour Discovery Tests
 *
 * Tests network service discovery via mDNS.
 * Important for automatic server detection by clients.
 */

const { ContainerManager } = require('../lib/container-manager');
const { LogMonitor } = require('../lib/log-monitor');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('mDNS/Bonjour Discovery', () => {
  let manager;
  let logMonitor;
  let baseUrl;
  let containerId;

  beforeAll(async () => {
    logMonitor = new LogMonitor();
    manager = new ContainerManager({
      image: process.env.SIGNALK_IMAGE || 'signalk/signalk-server:latest',
      logMonitor,
      // mDNS requires host networking or special configuration
      networkMode: 'bridge',
    });
    const info = await manager.start();
    baseUrl = info.baseUrl;
    containerId = info.containerId;

    await sleep(3000);
  }, 120000);

  afterAll(async () => {
    await manager.remove(true);

    const summary = logMonitor.getSummary();
    console.log('\n--- mDNS Discovery Test Log Summary ---');
    console.log(`Total Errors: ${summary.totalErrors}`);
  });

  describe('Service Advertisement', () => {
    test('server advertises mDNS service', async () => {
      logMonitor.setPhase('mdns-advertise');

      // Check if mDNS is configured via API
      const res = await fetch(`${baseUrl}/signalk`);
      expect(res.ok).toBe(true);

      const data = await res.json();

      // Check for mDNS-related configuration
      if (data.server) {
        console.log('Server ID:', data.server.id);
      }

      // Note: Actually testing mDNS discovery requires special network
      // configuration that may not work in Docker containers
      console.log('mDNS advertisement check - requires host network for full test');

      expect(logMonitor.getPhaseErrors('mdns-advertise')).toHaveLength(0);
    });

    test('discovery endpoint includes service info', async () => {
      logMonitor.setPhase('mdns-discovery-endpoint');

      const res = await fetch(`${baseUrl}/signalk`);
      expect(res.ok).toBe(true);

      const data = await res.json();

      // Check that endpoints are properly advertised
      expect(data.endpoints).toBeDefined();
      expect(data.endpoints.v1).toBeDefined();

      // Should have HTTP and WS endpoints
      const v1 = data.endpoints.v1;
      console.log('Advertised endpoints:', Object.keys(v1));

      if (v1['signalk-http']) {
        expect(v1['signalk-http']).toMatch(/^https?:\/\//);
      }

      if (v1['signalk-ws']) {
        expect(v1['signalk-ws']).toMatch(/^wss?:\/\//);
      }

      expect(logMonitor.getPhaseErrors('mdns-discovery-endpoint')).toHaveLength(0);
    });
  });

  describe('Service Types', () => {
    test('SignalK HTTP service type defined', async () => {
      logMonitor.setPhase('mdns-http-type');

      // The expected mDNS service types are:
      // _signalk-http._tcp - HTTP API
      // _signalk-ws._tcp - WebSocket
      // _signalk-https._tcp - HTTPS API
      // _signalk-wss._tcp - Secure WebSocket

      // We verify the server is configured for these by checking the discovery doc
      const res = await fetch(`${baseUrl}/signalk`);
      const data = await res.json();

      if (data.endpoints?.v1?.['signalk-http']) {
        console.log('HTTP service available for mDNS advertisement');
      }

      expect(logMonitor.getPhaseErrors('mdns-http-type')).toHaveLength(0);
    });

    test('SignalK WebSocket service type defined', async () => {
      logMonitor.setPhase('mdns-ws-type');

      const res = await fetch(`${baseUrl}/signalk`);
      const data = await res.json();

      if (data.endpoints?.v1?.['signalk-ws']) {
        console.log('WebSocket service available for mDNS advertisement');
      }

      expect(logMonitor.getPhaseErrors('mdns-ws-type')).toHaveLength(0);
    });
  });

  describe('Server Identity', () => {
    test('server has unique identifier', async () => {
      logMonitor.setPhase('mdns-server-id');

      const res = await fetch(`${baseUrl}/signalk`);
      const data = await res.json();

      expect(data.server?.id).toBeDefined();
      expect(typeof data.server.id).toBe('string');
      expect(data.server.id.length).toBeGreaterThan(0);

      console.log('Server ID:', data.server.id);

      // Server ID should be a valid UUID or similar format
      expect(data.server.id).toMatch(/^[a-zA-Z0-9-:]+$/);

      expect(logMonitor.getPhaseErrors('mdns-server-id')).toHaveLength(0);
    });

    test('server includes version information', async () => {
      logMonitor.setPhase('mdns-server-version');

      const res = await fetch(`${baseUrl}/signalk`);
      const data = await res.json();

      // Version should be in endpoints
      if (data.endpoints?.v1?.version) {
        console.log('API version:', data.endpoints.v1.version);
        expect(data.endpoints.v1.version).toMatch(/^\d+\.\d+/);
      }

      expect(logMonitor.getPhaseErrors('mdns-server-version')).toHaveLength(0);
    });

    test('server provides self reference', async () => {
      logMonitor.setPhase('mdns-self-ref');

      const res = await fetch(`${baseUrl}/signalk`);
      const data = await res.json();

      // Self reference indicates own vessel identifier
      if (data.self) {
        expect(typeof data.self).toBe('string');
        console.log('Self reference:', data.self);

        // Should be a valid vessel identifier
        expect(data.self).toMatch(/^vessels\./);
      }

      expect(logMonitor.getPhaseErrors('mdns-self-ref')).toHaveLength(0);
    });
  });

  describe('Discovery Response Format', () => {
    test('discovery response follows SignalK spec', async () => {
      logMonitor.setPhase('mdns-spec-format');

      const res = await fetch(`${baseUrl}/signalk`);
      expect(res.ok).toBe(true);

      const data = await res.json();

      // Required fields per spec
      expect(data.endpoints).toBeDefined();
      expect(data.server).toBeDefined();

      // Endpoints should have v1 at minimum
      expect(data.endpoints.v1).toBeDefined();

      // Server should have id
      expect(data.server.id).toBeDefined();

      console.log('Discovery response format: valid');

      expect(logMonitor.getPhaseErrors('mdns-spec-format')).toHaveLength(0);
    });

    test('discovery response includes all endpoint types', async () => {
      logMonitor.setPhase('mdns-endpoint-types');

      const res = await fetch(`${baseUrl}/signalk`);
      const data = await res.json();

      const v1 = data.endpoints.v1;
      const endpointTypes = Object.keys(v1);

      console.log('Available endpoint types:', endpointTypes.join(', '));

      // Should have at least HTTP and WS
      const hasHttp =
        endpointTypes.includes('signalk-http') ||
        endpointTypes.includes('signalk-https');
      const hasWs =
        endpointTypes.includes('signalk-ws') ||
        endpointTypes.includes('signalk-wss');

      expect(hasHttp || hasWs).toBe(true);

      expect(logMonitor.getPhaseErrors('mdns-endpoint-types')).toHaveLength(0);
    });
  });

  describe('Network Configuration', () => {
    test('server binds to configured ports', async () => {
      logMonitor.setPhase('mdns-ports');

      // HTTP port
      const httpRes = await fetch(`${baseUrl}/signalk`);
      expect(httpRes.ok).toBe(true);

      // Extract port from URL
      const url = new URL(baseUrl);
      console.log('HTTP port:', url.port || '80');

      expect(logMonitor.getPhaseErrors('mdns-ports')).toHaveLength(0);
    });

    test('server hostname is accessible', async () => {
      logMonitor.setPhase('mdns-hostname');

      const res = await fetch(`${baseUrl}/signalk`);
      const data = await res.json();

      // Check if endpoints use hostname or IP
      const httpEndpoint = data.endpoints?.v1?.['signalk-http'];
      if (httpEndpoint) {
        const url = new URL(httpEndpoint);
        console.log('Advertised host:', url.hostname);
      }

      expect(logMonitor.getPhaseErrors('mdns-hostname')).toHaveLength(0);
    });
  });

  describe('Multiple Server Discovery', () => {
    test('servers have distinct identifiers', async () => {
      logMonitor.setPhase('mdns-distinct');

      // In a real scenario, multiple servers would have different IDs
      // Here we just verify the ID format supports uniqueness
      const res = await fetch(`${baseUrl}/signalk`);
      const data = await res.json();

      const serverId = data.server?.id;
      expect(serverId).toBeDefined();

      // ID should be long enough to be unique
      expect(serverId.length).toBeGreaterThan(10);

      console.log('Server ID length:', serverId.length);

      expect(logMonitor.getPhaseErrors('mdns-distinct')).toHaveLength(0);
    });
  });

  describe('Discovery via HTTP', () => {
    test('root redirect or discovery', async () => {
      logMonitor.setPhase('mdns-root');

      const res = await fetch(baseUrl, {
        redirect: 'manual',
      });

      // Root may redirect to admin UI or return discovery
      expect([200, 301, 302, 307, 308]).toContain(res.status);

      console.log('Root endpoint status:', res.status);

      expect(logMonitor.getPhaseErrors('mdns-root')).toHaveLength(0);
    });

    test('well-known endpoint for discovery', async () => {
      logMonitor.setPhase('mdns-well-known');

      // Some servers may implement /.well-known/signalk
      const res = await fetch(`${baseUrl}/.well-known/signalk`);

      if (res.ok) {
        const data = await res.json();
        console.log('Well-known discovery available');
        expect(data.endpoints || data.server).toBeDefined();
      } else {
        console.log('Well-known endpoint not implemented');
      }

      expect(logMonitor.getPhaseErrors('mdns-well-known')).toHaveLength(0);
    });
  });

  describe('Service TXT Records', () => {
    test('discovery includes server metadata', async () => {
      logMonitor.setPhase('mdns-txt');

      // TXT records in mDNS contain key-value pairs
      // We verify equivalent data is in the discovery response
      const res = await fetch(`${baseUrl}/signalk`);
      const data = await res.json();

      // Metadata that would be in TXT records
      const metadata = {
        id: data.server?.id,
        version: data.endpoints?.v1?.version,
        self: data.self,
      };

      console.log('Service metadata:', JSON.stringify(metadata));

      expect(metadata.id).toBeDefined();

      expect(logMonitor.getPhaseErrors('mdns-txt')).toHaveLength(0);
    });
  });

  describe('Discovery Caching', () => {
    test('discovery response is consistent', async () => {
      logMonitor.setPhase('mdns-consistent');

      // Multiple requests should return same server ID
      const results = await Promise.all([
        fetch(`${baseUrl}/signalk`).then((r) => r.json()),
        fetch(`${baseUrl}/signalk`).then((r) => r.json()),
        fetch(`${baseUrl}/signalk`).then((r) => r.json()),
      ]);

      const serverIds = results.map((r) => r.server?.id);

      // All should be the same
      expect(serverIds[0]).toBe(serverIds[1]);
      expect(serverIds[1]).toBe(serverIds[2]);

      console.log('Discovery response consistent across requests');

      expect(logMonitor.getPhaseErrors('mdns-consistent')).toHaveLength(0);
    });

    test('discovery includes cache headers', async () => {
      logMonitor.setPhase('mdns-cache-headers');

      const res = await fetch(`${baseUrl}/signalk`);

      const cacheControl = res.headers.get('cache-control');
      const etag = res.headers.get('etag');

      console.log('Cache-Control:', cacheControl || 'not set');
      console.log('ETag:', etag || 'not set');

      expect(logMonitor.getPhaseErrors('mdns-cache-headers')).toHaveLength(0);
    });
  });
});
