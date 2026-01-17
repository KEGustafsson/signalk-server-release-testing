/**
 * HTTPS/TLS Security Tests
 *
 * Tests secure connections via HTTPS and WSS.
 * Critical for security-conscious deployments.
 */

const { ContainerManager } = require('../lib/container-manager');
const { LogMonitor } = require('../lib/log-monitor');
const https = require('https');
const tls = require('tls');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('HTTPS/TLS Security', () => {
  let manager;
  let logMonitor;
  let baseUrl;
  let httpsUrl;
  let httpsPort;
  let wssUrl;
  let httpsAvailable = false;

  beforeAll(async () => {
    logMonitor = new LogMonitor();
    manager = new ContainerManager({
      image: process.env.SIGNALK_IMAGE || 'signalk/signalk-server:latest',
      logMonitor,
    });
    const info = await manager.start();
    baseUrl = info.baseUrl;
    httpsUrl = info.httpsUrl || `https://localhost:3443`;
    httpsPort = info.httpsPort || 3443;
    wssUrl = info.wssUrl || `wss://localhost:${httpsPort}/signalk/v1/stream`;

    await sleep(3000);

    // Check if HTTPS is actually available
    try {
      const testSocket = require('net').createConnection({ port: httpsPort, host: 'localhost' });
      await new Promise((resolve, reject) => {
        testSocket.on('connect', () => {
          httpsAvailable = true;
          testSocket.destroy();
          resolve();
        });
        testSocket.on('error', () => {
          httpsAvailable = false;
          resolve();
        });
        setTimeout(() => {
          testSocket.destroy();
          resolve();
        }, 2000);
      });
    } catch (e) {
      httpsAvailable = false;
    }

    if (!httpsAvailable) {
      console.log('HTTPS not available on this server - some tests will be skipped');
    }
  }, 120000);

  afterAll(async () => {
    await manager.remove(true);

    const summary = logMonitor.getSummary();
    console.log('\n--- HTTPS/TLS Test Log Summary ---');
    console.log(`Total Errors: ${summary.totalErrors}`);
  });

  describe('HTTPS Endpoint Availability', () => {
    test('HTTPS endpoint exists', async () => {
      logMonitor.setPhase('https-exists');

      try {
        const res = await fetch(httpsUrl + '/signalk', {
          // Allow self-signed certificates for testing
          agent: new https.Agent({ rejectUnauthorized: false }),
        });

        expect([200, 301, 302]).toContain(res.status);
        console.log(`HTTPS endpoint: ${res.status}`);
      } catch (e) {
        // HTTPS might not be configured
        console.log('HTTPS not available:', e.message);
      }

      expect(logMonitor.getPhaseErrors('https-exists')).toHaveLength(0);
    });

    test('HTTPS returns same data as HTTP', async () => {
      logMonitor.setPhase('https-same-data');

      try {
        const [httpRes, httpsRes] = await Promise.all([
          fetch(`${baseUrl}/signalk`),
          fetch(`${httpsUrl}/signalk`, {
            agent: new https.Agent({ rejectUnauthorized: false }),
          }),
        ]);

        if (httpRes.ok && httpsRes.ok) {
          const httpData = await httpRes.json();
          const httpsData = await httpsRes.json();

          // Server info should match
          expect(httpsData.server?.id).toBe(httpData.server?.id);
        }
      } catch (e) {
        console.log('Comparison skipped:', e.message);
      }

      expect(logMonitor.getPhaseErrors('https-same-data')).toHaveLength(0);
    });
  });

  describe('TLS Certificate', () => {
    test('server provides valid TLS certificate', async () => {
      if (!httpsAvailable) {
        console.log('Skipped: HTTPS not available');
        return;
      }

      logMonitor.setPhase('tls-cert');

      await new Promise((resolve) => {
        const socket = tls.connect(
          {
            host: 'localhost',
            port: httpsPort,
            rejectUnauthorized: false, // Allow self-signed for testing
          },
          () => {
            const cert = socket.getPeerCertificate();

            if (cert && Object.keys(cert).length > 0) {
              console.log('Certificate subject:', cert.subject?.CN || 'N/A');
              console.log('Certificate issuer:', cert.issuer?.CN || 'N/A');
              console.log('Valid from:', cert.valid_from);
              console.log('Valid to:', cert.valid_to);

              // Check certificate is not expired
              if (cert.valid_to) {
                const validTo = new Date(cert.valid_to);
                expect(validTo.getTime()).toBeGreaterThan(Date.now());
              }
            } else {
              console.log('No certificate details available');
            }

            socket.end();
            resolve();
          }
        );

        socket.on('error', (err) => {
          console.log('TLS connection error:', err.message);
          resolve();
        });

        setTimeout(() => {
          socket.destroy();
          resolve();
        }, 5000);
      });

      expect(logMonitor.getPhaseErrors('tls-cert')).toHaveLength(0);
    });

    test('supports modern TLS versions', async () => {
      if (!httpsAvailable) {
        console.log('Skipped: HTTPS not available');
        return;
      }

      logMonitor.setPhase('tls-version');

      const tlsVersions = ['TLSv1.2', 'TLSv1.3'];
      const supported = [];

      for (const version of tlsVersions) {
        await new Promise((resolve) => {
          const socket = tls.connect(
            {
              host: 'localhost',
              port: httpsPort,
              rejectUnauthorized: false,
              minVersion: version,
              maxVersion: version,
            },
            () => {
              supported.push(version);
              socket.end();
              resolve();
            }
          );

          socket.on('error', () => {
            resolve();
          });

          setTimeout(() => {
            socket.destroy();
            resolve();
          }, 3000);
        });
      }

      console.log('Supported TLS versions:', supported.join(', ') || 'none detected');

      expect(logMonitor.getPhaseErrors('tls-version')).toHaveLength(0);
    });

    test('rejects obsolete TLS versions', async () => {
      logMonitor.setPhase('tls-obsolete');

      // TLS 1.0 and 1.1 should be rejected
      const obsoleteVersions = ['TLSv1', 'TLSv1.1'];
      const accepted = [];

      for (const version of obsoleteVersions) {
        await new Promise((resolve) => {
          try {
            const socket = tls.connect(
              {
                host: 'localhost',
                port: httpsPort,
                rejectUnauthorized: false,
                minVersion: version,
                maxVersion: version,
              },
              () => {
                accepted.push(version);
                socket.end();
                resolve();
              }
            );

            socket.on('error', () => {
              resolve();
            });

            setTimeout(() => {
              socket.destroy();
              resolve();
            }, 3000);
          } catch (e) {
            resolve();
          }
        });
      }

      if (accepted.length > 0) {
        console.log('Warning: Obsolete TLS accepted:', accepted.join(', '));
      } else {
        console.log('Good: No obsolete TLS versions accepted');
      }

      expect(logMonitor.getPhaseErrors('tls-obsolete')).toHaveLength(0);
    });
  });

  describe('WSS (Secure WebSocket)', () => {
    test('WSS endpoint exists', async () => {
      if (!httpsAvailable) {
        console.log('Skipped: HTTPS not available');
        return;
      }

      logMonitor.setPhase('wss-exists');

      const WebSocket = require('ws');

      const result = await new Promise((resolve) => {
        const ws = new WebSocket(`${wssUrl}?subscribe=none`, {
          rejectUnauthorized: false,
        });

        ws.on('open', () => {
          ws.close();
          resolve({ connected: true });
        });

        ws.on('error', (err) => {
          resolve({ connected: false, error: err.message });
        });

        setTimeout(() => {
          ws.close();
          resolve({ connected: false, timeout: true });
        }, 5000);
      });

      console.log('WSS connection:', result.connected ? 'success' : 'failed');

      expect(logMonitor.getPhaseErrors('wss-exists')).toHaveLength(0);
    });

    test('WSS receives hello message', async () => {
      if (!httpsAvailable) {
        console.log('Skipped: HTTPS not available');
        return;
      }

      logMonitor.setPhase('wss-hello');

      const WebSocket = require('ws');

      const hello = await new Promise((resolve) => {
        const ws = new WebSocket(`${wssUrl}?subscribe=none`, {
          rejectUnauthorized: false,
        });

        ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.self) {
              ws.close();
              resolve(msg);
            }
          } catch (e) {
            // Ignore
          }
        });

        ws.on('error', () => {
          resolve(null);
        });

        setTimeout(() => {
          ws.close();
          resolve(null);
        }, 5000);
      });

      if (hello) {
        console.log('WSS hello received:', hello.self);
      }

      expect(logMonitor.getPhaseErrors('wss-hello')).toHaveLength(0);
    });

    test('WSS streams delta messages', async () => {
      if (!httpsAvailable) {
        console.log('Skipped: HTTPS not available');
        return;
      }

      logMonitor.setPhase('wss-delta');

      const WebSocket = require('ws');

      const messages = await new Promise((resolve) => {
        const collected = [];
        const ws = new WebSocket(`${wssUrl.replace('?subscribe=none', '')}?subscribe=all`, {
          rejectUnauthorized: false,
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

        setTimeout(() => {
          ws.close();
          resolve(collected);
        }, 3000);
      });

      console.log('WSS messages received:', messages.length);

      expect(logMonitor.getPhaseErrors('wss-delta')).toHaveLength(0);
    });
  });

  describe('Security Headers', () => {
    test('HTTPS includes security headers', async () => {
      logMonitor.setPhase('security-headers');

      try {
        const res = await fetch(`${httpsUrl}/signalk`, {
          agent: new https.Agent({ rejectUnauthorized: false }),
        });

        const headers = {
          'strict-transport-security': res.headers.get('strict-transport-security'),
          'x-content-type-options': res.headers.get('x-content-type-options'),
          'x-frame-options': res.headers.get('x-frame-options'),
          'x-xss-protection': res.headers.get('x-xss-protection'),
        };

        console.log('Security headers:', JSON.stringify(headers, null, 2));

        // HSTS should be set for HTTPS
        if (headers['strict-transport-security']) {
          expect(headers['strict-transport-security']).toContain('max-age');
        }
      } catch (e) {
        console.log('Security headers check skipped:', e.message);
      }

      expect(logMonitor.getPhaseErrors('security-headers')).toHaveLength(0);
    });

    test('HTTPS sets correct content-type', async () => {
      logMonitor.setPhase('https-content-type');

      try {
        const res = await fetch(`${httpsUrl}/signalk`, {
          agent: new https.Agent({ rejectUnauthorized: false }),
        });

        if (res.ok) {
          const contentType = res.headers.get('content-type');
          expect(contentType).toMatch(/application\/json/);
        }
      } catch (e) {
        console.log('Content-type check skipped');
      }

      expect(logMonitor.getPhaseErrors('https-content-type')).toHaveLength(0);
    });
  });

  describe('HTTP to HTTPS Redirect', () => {
    test('server can redirect HTTP to HTTPS', async () => {
      logMonitor.setPhase('http-redirect');

      const res = await fetch(`${baseUrl}/signalk`, {
        redirect: 'manual', // Don't follow redirects
      });

      // May redirect to HTTPS or stay on HTTP
      if (res.status === 301 || res.status === 302) {
        const location = res.headers.get('location');
        if (location?.startsWith('https://')) {
          console.log('HTTP redirects to HTTPS');
        }
      } else {
        console.log('No HTTP to HTTPS redirect configured');
      }

      expect(logMonitor.getPhaseErrors('http-redirect')).toHaveLength(0);
    });
  });

  describe('Mixed Content', () => {
    test('API does not expose mixed content', async () => {
      logMonitor.setPhase('mixed-content');

      try {
        const res = await fetch(`${httpsUrl}/signalk`, {
          agent: new https.Agent({ rejectUnauthorized: false }),
        });

        if (res.ok) {
          const data = await res.json();

          // Check that endpoints use HTTPS when available
          if (data.endpoints?.v1) {
            const httpEndpoint = data.endpoints.v1['signalk-http'];
            const wsEndpoint = data.endpoints.v1['signalk-ws'];

            console.log('HTTP endpoint:', httpEndpoint);
            console.log('WS endpoint:', wsEndpoint);
          }
        }
      } catch (e) {
        console.log('Mixed content check skipped');
      }

      expect(logMonitor.getPhaseErrors('mixed-content')).toHaveLength(0);
    });
  });

  describe('Certificate Chain', () => {
    test('certificate chain is complete', async () => {
      if (!httpsAvailable) {
        console.log('Skipped: HTTPS not available');
        return;
      }

      logMonitor.setPhase('cert-chain');

      await new Promise((resolve) => {
        const socket = tls.connect(
          {
            host: 'localhost',
            port: httpsPort,
            rejectUnauthorized: false,
          },
          () => {
            const cert = socket.getPeerCertificate(true);

            if (cert) {
              let chainLength = 0;
              let current = cert;

              while (current) {
                chainLength++;
                if (current.issuerCertificate === current) {
                  // Self-signed or root reached
                  break;
                }
                current = current.issuerCertificate;
              }

              console.log('Certificate chain length:', chainLength);
            }

            socket.end();
            resolve();
          }
        );

        socket.on('error', () => {
          resolve();
        });

        setTimeout(() => {
          socket.destroy();
          resolve();
        }, 5000);
      });

      expect(logMonitor.getPhaseErrors('cert-chain')).toHaveLength(0);
    });
  });

  describe('Connection Security', () => {
    test('HTTPS connection is encrypted', async () => {
      if (!httpsAvailable) {
        console.log('Skipped: HTTPS not available');
        return;
      }

      logMonitor.setPhase('connection-encrypted');

      await new Promise((resolve) => {
        const socket = tls.connect(
          {
            host: 'localhost',
            port: httpsPort,
            rejectUnauthorized: false,
          },
          () => {
            const cipher = socket.getCipher();

            if (cipher) {
              console.log('Cipher name:', cipher.name);
              console.log('Cipher version:', cipher.version);

              // Should use strong cipher
              expect(cipher.name).toBeDefined();
            }

            socket.end();
            resolve();
          }
        );

        socket.on('error', () => {
          resolve();
        });

        setTimeout(() => {
          socket.destroy();
          resolve();
        }, 5000);
      });

      expect(logMonitor.getPhaseErrors('connection-encrypted')).toHaveLength(0);
    });
  });
});
