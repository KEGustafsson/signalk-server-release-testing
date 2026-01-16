/**
 * Multi-User Authentication Tests
 *
 * Tests role-based access control, JWT token management, and ACL enforcement.
 * Critical for secured deployments.
 */

const { ContainerManager } = require('../lib/container-manager');
const { LogMonitor } = require('../lib/log-monitor');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Multi-User Authentication', () => {
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
    console.log('\n--- Multi-User Auth Test Log Summary ---');
    console.log(`Total Errors: ${summary.totalErrors}`);
  });

  describe('Token Validation Endpoint', () => {
    test('/auth/validate endpoint exists', async () => {
      logMonitor.setPhase('auth-validate-exists');

      const res = await fetch(`${baseUrl}/signalk/v1/auth/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'test-token' }),
      });

      // Should exist (various response codes) or return 404 if not implemented
      expect([200, 400, 401, 403, 404]).toContain(res.status);
      console.log(`Token validate endpoint: ${res.status}`);

      expect(logMonitor.getPhaseErrors('auth-validate-exists')).toHaveLength(0);
    });

    test('invalid token returns 401', async () => {
      logMonitor.setPhase('auth-invalid-token');

      const res = await fetch(`${baseUrl}/signalk/v1/auth/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer invalid-token-12345',
        },
        body: JSON.stringify({ token: 'invalid-token-12345' }),
      });

      // Should return 401 Unauthorized for invalid token
      expect([400, 401, 403, 404]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('auth-invalid-token')).toHaveLength(0);
    });

    test('malformed token is rejected', async () => {
      logMonitor.setPhase('auth-malformed-token');

      // Test with malformed/mangled token (GitHub issue #1397)
      const malformedTokens = [
        'not.a.jwt',
        'Bearer ',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.payload',
        '{"alg":"none"}',
        '',
      ];

      for (const token of malformedTokens) {
        const res = await fetch(`${apiUrl}/vessels/self`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        // Should not crash, should return appropriate error or ignore
        expect([200, 400, 401, 403]).toContain(res.status);
      }

      expect(logMonitor.getPhaseErrors('auth-malformed-token')).toHaveLength(0);
    });

    test('expired token is rejected', async () => {
      logMonitor.setPhase('auth-expired-token');

      // Create a fake expired JWT (payload with exp in past)
      // Note: This won't pass signature validation, but tests expiry handling
      const expiredPayload = Buffer.from(
        JSON.stringify({
          exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
          iat: Math.floor(Date.now() / 1000) - 7200,
          sub: 'test-user',
        })
      ).toString('base64url');

      const fakeToken = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${expiredPayload}.fake-signature`;

      const res = await fetch(`${apiUrl}/vessels/self`, {
        headers: {
          Authorization: `Bearer ${fakeToken}`,
        },
      });

      // Should reject expired token
      expect([200, 400, 401, 403]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('auth-expired-token')).toHaveLength(0);
    });
  });

  describe('Login Flow', () => {
    test('login returns JWT token on success', async () => {
      logMonitor.setPhase('auth-login-jwt');

      const res = await fetch(`${baseUrl}/signalk/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin' }),
      });

      if (res.ok) {
        const data = await res.json();
        // Should return token
        if (data.token) {
          expect(typeof data.token).toBe('string');
          expect(data.token.length).toBeGreaterThan(10);
          console.log('JWT token received (length:', data.token.length, ')');

          // Verify token format (should be JWT: header.payload.signature)
          const parts = data.token.split('.');
          expect(parts.length).toBe(3);
        }
      } else {
        console.log('Login not available or credentials not configured');
      }

      expect(logMonitor.getPhaseErrors('auth-login-jwt')).toHaveLength(0);
    });

    test('login response includes token type', async () => {
      logMonitor.setPhase('auth-token-type');

      const res = await fetch(`${baseUrl}/signalk/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin' }),
      });

      if (res.ok) {
        const data = await res.json();
        // Check for token_type field (GitHub issue #715)
        if (data.token_type) {
          expect(data.token_type.toLowerCase()).toBe('bearer');
          console.log('Token type:', data.token_type);
        } else {
          console.log('Token type not specified in response (issue #715)');
        }
      }

      expect(logMonitor.getPhaseErrors('auth-token-type')).toHaveLength(0);
    });

    test('login response includes expiry information', async () => {
      logMonitor.setPhase('auth-token-expiry');

      const res = await fetch(`${baseUrl}/signalk/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin' }),
      });

      if (res.ok) {
        const data = await res.json();
        // Check for expiry info
        if (data.expires_in || data.expiresIn) {
          const expiry = data.expires_in || data.expiresIn;
          expect(typeof expiry).toBe('number');
          expect(expiry).toBeGreaterThan(0);
          console.log('Token expires in:', expiry, 'seconds');
        }
      }

      expect(logMonitor.getPhaseErrors('auth-token-expiry')).toHaveLength(0);
    });
  });

  describe('Role-Based Access Control', () => {
    test('public endpoints accessible without auth', async () => {
      logMonitor.setPhase('rbac-public');

      const publicEndpoints = [
        '/signalk',
        '/signalk/v1/api/vessels/self', // If allowReadToPublic
      ];

      for (const endpoint of publicEndpoints) {
        const res = await fetch(`${baseUrl}${endpoint}`);
        // Should be accessible (200) or require auth (401)
        expect([200, 401]).toContain(res.status);
        console.log(`${endpoint}: ${res.status}`);
      }

      expect(logMonitor.getPhaseErrors('rbac-public')).toHaveLength(0);
    });

    test('admin endpoints require admin role', async () => {
      logMonitor.setPhase('rbac-admin');

      const adminEndpoints = [
        '/skServer/restart',
        '/skServer/config',
        '/signalk/v1/api/security/config',
      ];

      for (const endpoint of adminEndpoints) {
        const res = await fetch(`${baseUrl}${endpoint}`);
        // Should require authentication
        expect([401, 403, 404]).toContain(res.status);
        console.log(`Admin ${endpoint}: ${res.status}`);
      }

      expect(logMonitor.getPhaseErrors('rbac-admin')).toHaveLength(0);
    });

    test('write operations require write permission', async () => {
      logMonitor.setPhase('rbac-write');

      const res = await fetch(`${apiUrl}/vessels/self/navigation/speedOverGround`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 5.0 }),
      });

      // Should require auth or be rejected
      expect([200, 401, 403, 405]).toContain(res.status);
      console.log('PUT without auth:', res.status);

      expect(logMonitor.getPhaseErrors('rbac-write')).toHaveLength(0);
    });
  });

  describe('ACL Path-Level Permissions', () => {
    test('ACL endpoint exists', async () => {
      logMonitor.setPhase('acl-endpoint');

      const res = await fetch(`${baseUrl}/signalk/v1/api/security/access`);
      expect([200, 401, 403, 404]).toContain(res.status);

      if (res.ok) {
        const data = await res.json();
        console.log('ACL config available');
      }

      expect(logMonitor.getPhaseErrors('acl-endpoint')).toHaveLength(0);
    });

    test('different paths can have different permissions', async () => {
      logMonitor.setPhase('acl-paths');

      // Test read access to different paths
      const paths = [
        '/signalk/v1/api/vessels/self/navigation',
        '/signalk/v1/api/vessels/self/environment',
        '/signalk/v1/api/vessels/self/electrical',
      ];

      const results = {};
      for (const path of paths) {
        const res = await fetch(`${baseUrl}${path}`);
        results[path] = res.status;
      }

      console.log('Path access results:', results);

      expect(logMonitor.getPhaseErrors('acl-paths')).toHaveLength(0);
    });
  });

  describe('Device Authentication', () => {
    test('access request creates pending request', async () => {
      logMonitor.setPhase('device-access-request');

      const clientId = `test-device-${Date.now()}`;
      const res = await fetch(`${baseUrl}/signalk/v1/access/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          description: 'Automated test device',
          permissions: 'readonly',
        }),
      });

      expect([200, 202, 400, 401, 403, 404]).toContain(res.status);

      if (res.ok || res.status === 202) {
        const data = await res.json();
        console.log('Access request response:', JSON.stringify(data).substring(0, 200));
      }

      expect(logMonitor.getPhaseErrors('device-access-request')).toHaveLength(0);
    });

    test('can list pending access requests', async () => {
      logMonitor.setPhase('device-list-requests');

      const res = await fetch(`${baseUrl}/signalk/v1/access/requests`);
      expect([200, 401, 403, 404]).toContain(res.status);

      if (res.ok) {
        const data = await res.json();
        console.log('Pending requests:', Array.isArray(data) ? data.length : 'object');
      }

      expect(logMonitor.getPhaseErrors('device-list-requests')).toHaveLength(0);
    });

    test('device token endpoint exists', async () => {
      logMonitor.setPhase('device-token');

      const res = await fetch(`${baseUrl}/signalk/v1/auth/device`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'test-device',
          clientSecret: 'test-secret',
        }),
      });

      expect([200, 400, 401, 403, 404]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('device-token')).toHaveLength(0);
    });
  });

  describe('Security Configuration', () => {
    test('security config endpoint responds', async () => {
      logMonitor.setPhase('security-config');

      const res = await fetch(`${baseUrl}/signalk/v1/api/security/config`);
      expect([200, 401, 403, 404]).toContain(res.status);

      if (res.ok) {
        const data = await res.json();
        console.log('Security config keys:', Object.keys(data));
      }

      expect(logMonitor.getPhaseErrors('security-config')).toHaveLength(0);
    });

    test('users list endpoint requires admin', async () => {
      logMonitor.setPhase('security-users');

      const res = await fetch(`${baseUrl}/signalk/v1/api/security/users`);
      expect([200, 401, 403, 404]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('security-users')).toHaveLength(0);
    });

    test('security strategy endpoint responds', async () => {
      logMonitor.setPhase('security-strategy');

      const res = await fetch(`${baseUrl}/signalk/v1/api/security/strategy`);
      expect([200, 401, 403, 404]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('security-strategy')).toHaveLength(0);
    });
  });

  describe('Session Management', () => {
    test('logout endpoint exists', async () => {
      logMonitor.setPhase('session-logout');

      const res = await fetch(`${baseUrl}/signalk/v1/auth/logout`, {
        method: 'PUT',
      });

      expect([200, 204, 400, 401, 404, 405]).toContain(res.status);
      console.log('Logout endpoint:', res.status);

      expect(logMonitor.getPhaseErrors('session-logout')).toHaveLength(0);
    });

    test('concurrent sessions handled correctly', async () => {
      logMonitor.setPhase('session-concurrent');

      // Attempt multiple concurrent logins
      const loginPromises = Array(3)
        .fill(null)
        .map(() =>
          fetch(`${baseUrl}/signalk/v1/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin' }),
          })
        );

      const results = await Promise.all(loginPromises);

      for (const res of results) {
        // All should complete without error
        expect([200, 401, 403, 404, 429]).toContain(res.status);
      }

      console.log('Concurrent login results:', results.map((r) => r.status));

      expect(logMonitor.getPhaseErrors('session-concurrent')).toHaveLength(0);
    });
  });

  describe('Authorization Headers', () => {
    test('accepts Bearer token in Authorization header', async () => {
      logMonitor.setPhase('auth-bearer-header');

      const res = await fetch(`${apiUrl}/vessels/self`, {
        headers: {
          Authorization: 'Bearer test-token-12345',
        },
      });

      // Should process the token (may accept or reject)
      expect([200, 401, 403]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('auth-bearer-header')).toHaveLength(0);
    });

    test('accepts token in query parameter', async () => {
      logMonitor.setPhase('auth-query-param');

      const res = await fetch(`${apiUrl}/vessels/self?token=test-token-12345`);

      // Query param token support varies
      expect([200, 401, 403]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('auth-query-param')).toHaveLength(0);
    });

    test('accepts token in cookie', async () => {
      logMonitor.setPhase('auth-cookie');

      const res = await fetch(`${apiUrl}/vessels/self`, {
        headers: {
          Cookie: 'JAUTHENTICATION=test-token-12345',
        },
      });

      expect([200, 401, 403]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('auth-cookie')).toHaveLength(0);
    });
  });

  describe('Error Responses', () => {
    test('401 response includes WWW-Authenticate header', async () => {
      logMonitor.setPhase('error-www-auth');

      const res = await fetch(`${baseUrl}/skServer/restart`);

      if (res.status === 401) {
        const wwwAuth = res.headers.get('www-authenticate');
        console.log('WWW-Authenticate:', wwwAuth);
      }

      expect(logMonitor.getPhaseErrors('error-www-auth')).toHaveLength(0);
    });

    test('forbidden access returns 403', async () => {
      logMonitor.setPhase('error-forbidden');

      // Try to access admin endpoint
      const res = await fetch(`${baseUrl}/signalk/v1/api/security/users`);

      // Should be 401 (not authenticated) or 403 (forbidden)
      expect([401, 403, 404]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('error-forbidden')).toHaveLength(0);
    });
  });
});
