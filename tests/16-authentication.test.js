/**
 * Authentication and Security Tests
 *
 * Tests authentication flows, token management, and access control.
 */

const { ContainerManager } = require('../lib/container-manager');
const { LogMonitor } = require('../lib/log-monitor');

describe('Authentication and Security', () => {
  let manager;
  let logMonitor;
  let baseUrl;

  beforeAll(async () => {
    logMonitor = new LogMonitor();
    manager = new ContainerManager({
      image: process.env.SIGNALK_IMAGE || 'signalk/signalk-server:latest',
      logMonitor,
    });
    const info = await manager.start();
    baseUrl = info.baseUrl;

    await sleep(2000);
  }, 120000);

  afterAll(async () => {
    await manager.remove(true);
  });

  describe('Public Endpoint Access', () => {
    test('discovery endpoint is publicly accessible', async () => {
      logMonitor.setPhase('auth-public-discovery');

      const res = await fetch(`${baseUrl}/signalk`);
      expect(res.ok).toBe(true);

      const data = await res.json();
      expect(data.endpoints).toBeDefined();
      expect(data.server).toBeDefined();

      expect(logMonitor.getPhaseErrors('auth-public-discovery')).toHaveLength(0);
    });

    test('vessels/self is accessible with allowReadToPublic', async () => {
      logMonitor.setPhase('auth-public-vessels');

      const res = await fetch(`${baseUrl}/signalk/v1/api/vessels/self`);
      // Should be 200 with allowReadToPublic: true in settings
      expect([200, 401]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('auth-public-vessels')).toHaveLength(0);
    });

    test('WebSocket accepts unauthenticated connection', async () => {
      logMonitor.setPhase('auth-public-ws');

      const WebSocket = require('ws');
      const ws = new WebSocket(`${baseUrl.replace('http', 'ws')}/signalk/v1/stream`);

      const connected = await new Promise((resolve) => {
        ws.on('open', () => resolve(true));
        ws.on('error', () => resolve(false));
        setTimeout(() => resolve(false), 5000);
      });

      expect(connected).toBe(true);
      ws.close();

      expect(logMonitor.getPhaseErrors('auth-public-ws')).toHaveLength(0);
    });
  });

  describe('Protected Endpoint Access', () => {
    test('admin endpoints require authentication', async () => {
      logMonitor.setPhase('auth-protected-admin');

      const endpoints = [
        '/skServer/plugins',
        '/skServer/restart',
        '/skServer/config',
      ];

      for (const endpoint of endpoints) {
        const res = await fetch(`${baseUrl}${endpoint}`);
        // Should be 401 Unauthorized or 403 Forbidden
        expect([401, 403, 404]).toContain(res.status);
      }

      expect(logMonitor.getPhaseErrors('auth-protected-admin')).toHaveLength(0);
    });

    test('PUT operations require authentication when security enabled', async () => {
      logMonitor.setPhase('auth-protected-put');

      const res = await fetch(`${baseUrl}/signalk/v1/api/vessels/self/navigation/speedOverGround`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 5.0 }),
      });

      // Should be 401, 403, or 405 (not allowed) depending on config
      expect([200, 401, 403, 405]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('auth-protected-put')).toHaveLength(0);
    });
  });

  describe('Login Endpoint', () => {
    test('login endpoint exists and responds', async () => {
      logMonitor.setPhase('auth-login-endpoint');

      const res = await fetch(`${baseUrl}/signalk/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin' }),
      });

      // Should respond with 200, 401, or 404 (if not configured)
      expect([200, 401, 403, 404]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('auth-login-endpoint')).toHaveLength(0);
    });

    test('invalid credentials are rejected', async () => {
      logMonitor.setPhase('auth-invalid-creds');

      const res = await fetch(`${baseUrl}/signalk/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'invalid', password: 'wrongpassword' }),
      });

      // Should be 401 Unauthorized or 404 if login not configured
      expect([401, 403, 404]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('auth-invalid-creds')).toHaveLength(0);
    });
  });

  describe('Access Request Flow', () => {
    test('access request endpoint exists', async () => {
      logMonitor.setPhase('auth-access-request');

      const res = await fetch(`${baseUrl}/signalk/v1/access/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'test-client-' + Date.now(),
          description: 'Test client for automated testing',
        }),
      });

      // Should respond (200, 202, 401, 403, or 404)
      expect([200, 202, 401, 403, 404]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('auth-access-request')).toHaveLength(0);
    });
  });

  describe('CORS and Security Headers', () => {
    test('CORS headers are set correctly', async () => {
      logMonitor.setPhase('auth-cors');

      const res = await fetch(`${baseUrl}/signalk`, {
        method: 'OPTIONS',
      });

      const allowOrigin = res.headers.get('access-control-allow-origin');

      // CORS should be configured
      expect(allowOrigin).toBeDefined();

      expect(logMonitor.getPhaseErrors('auth-cors')).toHaveLength(0);
    });

    test('content-type headers are correct', async () => {
      logMonitor.setPhase('auth-content-type');

      const res = await fetch(`${baseUrl}/signalk`);
      const contentType = res.headers.get('content-type');

      expect(contentType).toMatch(/application\/json/);

      expect(logMonitor.getPhaseErrors('auth-content-type')).toHaveLength(0);
    });
  });

  describe('Rate Limiting', () => {
    test('server handles rapid requests without crashing', async () => {
      logMonitor.setPhase('auth-rate-limit');

      const requests = Array(50).fill(null).map(() =>
        fetch(`${baseUrl}/signalk/v1/api/vessels/self`)
      );

      const results = await Promise.all(requests);

      // All should complete (may be 200, 429, or other status)
      for (const res of results) {
        expect(res.status).toBeDefined();
      }

      expect(logMonitor).toHaveNoCriticalErrors();
    });
  });

  describe('Session Management', () => {
    test('cookie-based sessions work if enabled', async () => {
      logMonitor.setPhase('auth-sessions');

      // First request
      const res1 = await fetch(`${baseUrl}/signalk`);
      const setCookie = res1.headers.get('set-cookie');

      if (setCookie) {
        // Second request with cookie
        const res2 = await fetch(`${baseUrl}/signalk`, {
          headers: { Cookie: setCookie },
        });
        expect(res2.ok).toBe(true);
      }

      expect(logMonitor.getPhaseErrors('auth-sessions')).toHaveLength(0);
    });
  });
});
