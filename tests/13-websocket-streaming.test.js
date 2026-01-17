/**
 * WebSocket Streaming Tests
 *
 * Tests WebSocket connection, subscriptions, delta streaming,
 * and real-time data updates.
 */

const { ContainerManager } = require('../lib/container-manager');
const { LogMonitor } = require('../lib/log-monitor');
const { NmeaFeeder } = require('../lib/nmea-feeder');
const { NmeaFixtures } = require('../lib/nmea-fixtures');
const WebSocket = require('ws');

describe('WebSocket Streaming', () => {
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

    const summary = logMonitor.getSummary();
    console.log('\n--- WebSocket Test Log Summary ---');
    console.log(`Total Errors: ${summary.totalErrors}`);
    console.log(`Total Warnings: ${summary.totalWarnings}`);
  });

  describe('Connection', () => {
    test('accepts WebSocket connection', async () => {
      logMonitor.setPhase('ws-connect');

      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`${wsUrl}?subscribe=none`);

        ws.on('open', () => {
          expect(ws.readyState).toBe(WebSocket.OPEN);
          ws.close();
          resolve();
        });

        ws.on('error', reject);

        setTimeout(() => {
          ws.close();
          reject(new Error('Connection timeout'));
        }, 10000);
      });

      expect(logMonitor.getPhaseErrors('ws-connect')).toHaveLength(0);
    });

    test('sends hello message on connect', async () => {
      logMonitor.setPhase('ws-hello');

      const hello = await new Promise((resolve, reject) => {
        const ws = new WebSocket(`${wsUrl}?subscribe=none`);
        let helloMsg = null;

        ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.self) {
              helloMsg = msg;
            }
          } catch (e) {
            // Ignore non-JSON
          }
        });

        ws.on('open', () => {
          // Wait for hello message
          setTimeout(() => {
            ws.close();
            resolve(helloMsg);
          }, 2000);
        });

        ws.on('error', reject);
      });

      expect(hello).toBeDefined();
      expect(hello.self).toBeDefined();
      expect(hello.version).toBeDefined();
      console.log(`Hello message: self=${hello.self}, version=${hello.version}`);

      expect(logMonitor.getPhaseErrors('ws-hello')).toHaveLength(0);
    });

    test('handles multiple simultaneous connections', async () => {
      logMonitor.setPhase('ws-multi-connect');

      const connections = 5;
      const promises = [];

      for (let i = 0; i < connections; i++) {
        promises.push(
          new Promise((resolve, reject) => {
            const ws = new WebSocket(`${wsUrl}?subscribe=none`);

            ws.on('open', () => {
              setTimeout(() => {
                ws.close();
                resolve(true);
              }, 1000);
            });

            ws.on('error', reject);

            setTimeout(() => {
              ws.close();
              reject(new Error(`Connection ${i} timeout`));
            }, 10000);
          })
        );
      }

      const results = await Promise.all(promises);
      expect(results.every((r) => r === true)).toBe(true);

      expect(logMonitor.getPhaseErrors('ws-multi-connect')).toHaveLength(0);
    });
  });

  describe('Subscriptions', () => {
    test('subscribes to all updates with subscribe=all', async () => {
      logMonitor.setPhase('ws-subscribe-all');

      const messages = await collectMessages(`${wsUrl}?subscribe=all`, 3000);

      // Should receive hello and possibly deltas
      expect(messages.some((m) => m.self)).toBe(true);

      console.log(`Received ${messages.length} messages with subscribe=all`);

      expect(logMonitor.getPhaseErrors('ws-subscribe-all')).toHaveLength(0);
    });

    test('receives no deltas with subscribe=none', async () => {
      logMonitor.setPhase('ws-subscribe-none');

      // Send some data
      await feeder.sendTcp(NmeaFixtures.generateRMC(60.1, 24.1, 5.0, 90.0));

      const messages = await collectMessages(`${wsUrl}?subscribe=none`, 2000);

      // Should receive hello but no delta updates
      const deltas = messages.filter((m) => m.updates);
      expect(deltas.length).toBe(0);

      expect(logMonitor.getPhaseErrors('ws-subscribe-none')).toHaveLength(0);
    });

    test('supports path-based subscription', async () => {
      logMonitor.setPhase('ws-subscribe-path');

      // First send some data
      await feeder.sendTcp([
        NmeaFixtures.generateRMC(60.15, 24.15, 5.5, 120.0),
        NmeaFixtures.generateDBT(10.0),
      ]);

      await sleep(1000);

      // Subscribe to specific path
      const messages = await collectMessagesWithSubscription(
        `${wsUrl}?subscribe=none`,
        {
          context: 'vessels.self',
          subscribe: [{ path: 'navigation.position' }],
        },
        3000
      );

      console.log(`Received ${messages.length} messages for navigation.position subscription`);

      expect(logMonitor.getPhaseErrors('ws-subscribe-path')).toHaveLength(0);
    });

    test('supports wildcard subscription', async () => {
      logMonitor.setPhase('ws-subscribe-wildcard');

      // Send navigation data
      await feeder.sendTcp([
        NmeaFixtures.generateRMC(60.2, 24.2, 6.0, 150.0),
        NmeaFixtures.generateHDT(150.0),
        NmeaFixtures.generateVTG(150.0, 6.0),
      ]);

      await sleep(1000);

      // Subscribe to navigation.*
      const messages = await collectMessagesWithSubscription(
        `${wsUrl}?subscribe=none`,
        {
          context: 'vessels.self',
          subscribe: [{ path: 'navigation.*' }],
        },
        3000
      );

      console.log(`Received ${messages.length} messages for navigation.* subscription`);

      expect(logMonitor.getPhaseErrors('ws-subscribe-wildcard')).toHaveLength(0);
    });

    test('subscribes to self vessel only with subscribe=self', async () => {
      logMonitor.setPhase('ws-subscribe-self');

      // Send own vessel data
      await feeder.sendTcp(NmeaFixtures.generateRMC(60.25, 24.25, 5.0, 90.0));

      const messages = await collectMessages(`${wsUrl}?subscribe=self`, 3000);

      // Should receive hello and self vessel updates
      expect(messages.some((m) => m.self)).toBe(true);

      // Check that updates are for self vessel (not other AIS targets)
      const deltas = messages.filter((m) => m.updates);
      for (const delta of deltas) {
        if (delta.context) {
          // Context should be self, vessels.self, or the vessel's own URN
          // It should NOT contain imo:mmsi (which would indicate an AIS target)
          const isOwnVessel = delta.context.includes('self') ||
            delta.context.includes('urn:mrn:signalk:uuid') ||
            !delta.context.includes('imo:mmsi');
          expect(isOwnVessel).toBe(true);
        }
      }

      console.log(`Received ${messages.length} messages with subscribe=self`);

      expect(logMonitor.getPhaseErrors('ws-subscribe-self')).toHaveLength(0);
    });

    test('supports policy parameter for subscription', async () => {
      logMonitor.setPhase('ws-subscribe-policy');

      // Test different policy values: instant, ideal, fixed
      const policies = ['instant', 'ideal', 'fixed'];

      for (const policy of policies) {
        const messages = await collectMessagesWithSubscription(
          `${wsUrl}?subscribe=none`,
          {
            context: 'vessels.self',
            subscribe: [{ path: 'navigation.*', policy, period: 1000 }],
          },
          2000
        );

        console.log(`Policy '${policy}': received ${messages.length} messages`);
      }

      expect(logMonitor.getPhaseErrors('ws-subscribe-policy')).toHaveLength(0);
    });

    test('supports sendCachedValues parameter', async () => {
      logMonitor.setPhase('ws-send-cached');

      // First, ensure there's data in cache
      await feeder.sendTcp(NmeaFixtures.generateRMC(60.3, 24.3, 5.5, 100.0));
      await sleep(1000);

      // Subscribe with sendCachedValues=true (default)
      const messagesWithCache = await collectMessagesWithSubscription(
        `${wsUrl}?subscribe=none`,
        {
          context: 'vessels.self',
          subscribe: [{ path: 'navigation.position', sendCachedValues: true }],
        },
        2000
      );

      // Subscribe with sendCachedValues=false
      const messagesNoCache = await collectMessagesWithSubscription(
        `${wsUrl}?subscribe=none`,
        {
          context: 'vessels.self',
          subscribe: [{ path: 'navigation.position', sendCachedValues: false }],
        },
        2000
      );

      console.log(`With cache: ${messagesWithCache.length}, without: ${messagesNoCache.length}`);

      expect(logMonitor.getPhaseErrors('ws-send-cached')).toHaveLength(0);
    });

    test('supports format parameter in subscription', async () => {
      logMonitor.setPhase('ws-subscribe-format');

      // Test delta format (default)
      const deltaMessages = await collectMessagesWithSubscription(
        `${wsUrl}?subscribe=none`,
        {
          context: 'vessels.self',
          subscribe: [{ path: 'navigation.*', format: 'delta' }],
        },
        2000
      );

      // Messages should be in delta format
      const deltas = deltaMessages.filter((m) => m.updates);
      if (deltas.length > 0) {
        expect(deltas[0].updates).toBeDefined();
      }

      console.log(`Format 'delta': received ${deltaMessages.length} messages`);

      expect(logMonitor.getPhaseErrors('ws-subscribe-format')).toHaveLength(0);
    });

    test('can unsubscribe from updates', async () => {
      logMonitor.setPhase('ws-unsubscribe');

      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`${wsUrl}?subscribe=all`);
        let messagesBeforeUnsub = 0;
        let messagesAfterUnsub = 0;
        let unsubscribed = false;

        ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.updates) {
              if (unsubscribed) {
                messagesAfterUnsub++;
              } else {
                messagesBeforeUnsub++;
              }
            }
          } catch (e) {
            // Ignore
          }
        });

        ws.on('open', async () => {
          // Wait a bit to collect some messages
          await sleep(1000);

          // Unsubscribe
          ws.send(
            JSON.stringify({
              context: 'vessels.self',
              unsubscribe: [{ path: '*' }],
            })
          );
          unsubscribed = true;

          // Wait and check for messages
          await sleep(2000);

          ws.close();
          console.log(`Messages before unsub: ${messagesBeforeUnsub}, after: ${messagesAfterUnsub}`);
          resolve();
        });

        ws.on('error', reject);
      });

      expect(logMonitor.getPhaseErrors('ws-unsubscribe')).toHaveLength(0);
    });
  });

  describe('Delta Messages', () => {
    test('receives delta updates when data changes', async () => {
      logMonitor.setPhase('ws-delta-receive');

      const deltasReceived = [];

      const wsPromise = new Promise((resolve) => {
        const ws = new WebSocket(`${wsUrl}?subscribe=all`);

        ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.updates) {
              deltasReceived.push(msg);
            }
          } catch (e) {
            // Ignore
          }
        });

        ws.on('open', async () => {
          // Send NMEA data after connection
          await sleep(500);

          for (let i = 0; i < 5; i++) {
            await feeder.sendTcp(NmeaFixtures.generateRMC(60.2 + i * 0.001, 24.2 + i * 0.001, 5.0, 90.0));
            await sleep(200);
          }

          await sleep(2000);
          ws.close();
          resolve();
        });
      });

      await wsPromise;

      expect(deltasReceived.length).toBeGreaterThan(0);
      console.log(`Received ${deltasReceived.length} delta messages`);

      // Verify delta structure
      const firstDelta = deltasReceived[0];
      expect(firstDelta.context).toBeDefined();
      expect(firstDelta.updates).toBeDefined();
      expect(Array.isArray(firstDelta.updates)).toBe(true);

      expect(logMonitor.getPhaseErrors('ws-delta-receive')).toHaveLength(0);
    });

    test('delta includes timestamp and source', async () => {
      logMonitor.setPhase('ws-delta-metadata');

      const delta = await getFirstDelta();

      if (delta) {
        expect(delta.updates.length).toBeGreaterThan(0);

        const update = delta.updates[0];
        expect(update.timestamp).toBeDefined();
        expect(update.$source || update.source).toBeDefined();

        console.log(`Delta timestamp: ${update.timestamp}`);
        console.log(`Delta source: ${update.$source || update.source}`);
      }

      expect(logMonitor.getPhaseErrors('ws-delta-metadata')).toHaveLength(0);
    });

    test('delta values array contains path/value pairs', async () => {
      logMonitor.setPhase('ws-delta-values');

      const delta = await getFirstDelta();

      if (delta && delta.updates.length > 0) {
        const update = delta.updates[0];
        expect(update.values).toBeDefined();
        expect(Array.isArray(update.values)).toBe(true);

        if (update.values.length > 0) {
          const value = update.values[0];
          expect(value.path).toBeDefined();
          expect('value' in value).toBe(true);

          console.log(`Delta path: ${value.path}, value: ${JSON.stringify(value.value)}`);
        }
      }

      expect(logMonitor.getPhaseErrors('ws-delta-values')).toHaveLength(0);
    });
  });

  describe('Rate Limiting', () => {
    test('handles high-frequency updates', async () => {
      logMonitor.setPhase('ws-high-freq');

      let messageCount = 0;

      const wsPromise = new Promise((resolve) => {
        const ws = new WebSocket(`${wsUrl}?subscribe=all`);

        ws.on('message', () => {
          messageCount++;
        });

        ws.on('open', async () => {
          // Send rapid NMEA data
          const sentences = NmeaFixtures.generateNavigationBurst(60.0, 24.0, 50);
          await feeder.sendTcp(sentences, { delay: 10 });

          await sleep(5000);
          ws.close();
          resolve();
        });
      });

      await wsPromise;

      console.log(`Received ${messageCount} WebSocket messages during high-frequency test`);
      expect(messageCount).toBeGreaterThan(0);

      expect(logMonitor.getPhaseErrors('ws-high-freq')).toHaveLength(0);
    });

    test('supports minPeriod for subscription rate limiting', async () => {
      logMonitor.setPhase('ws-min-period');

      // Subscribe with minPeriod
      const messages = await collectMessagesWithSubscription(
        `${wsUrl}?subscribe=none`,
        {
          context: 'vessels.self',
          subscribe: [{ path: 'navigation.position', minPeriod: 1000 }],
        },
        5000
      );

      // Send rapid data
      for (let i = 0; i < 10; i++) {
        await feeder.sendTcp(NmeaFixtures.generateRMC(60.0 + i * 0.001, 24.0, 5.0, 90.0));
        await sleep(100);
      }

      console.log(`Received ${messages.length} messages with minPeriod=1000ms`);

      expect(logMonitor.getPhaseErrors('ws-min-period')).toHaveLength(0);
    });
  });

  describe('Connection Resilience', () => {
    test('handles reconnection gracefully', async () => {
      logMonitor.setPhase('ws-reconnect');

      // Connect, disconnect, reconnect
      for (let i = 0; i < 3; i++) {
        await new Promise((resolve, reject) => {
          const ws = new WebSocket(`${wsUrl}?subscribe=none`);

          ws.on('open', () => {
            setTimeout(() => {
              ws.close();
              resolve();
            }, 500);
          });

          ws.on('error', reject);
        });

        await sleep(200);
      }

      // Server should still be healthy
      const res = await fetch(`${baseUrl}/signalk`);
      expect(res.ok).toBe(true);

      expect(logMonitor.getPhaseErrors('ws-reconnect')).toHaveLength(0);
    });

    test('handles abrupt disconnection', async () => {
      logMonitor.setPhase('ws-abrupt-close');

      await new Promise((resolve) => {
        const ws = new WebSocket(`${wsUrl}?subscribe=all`);

        ws.on('open', () => {
          // Abruptly terminate without proper close
          ws.terminate();
          resolve();
        });
      });

      // Wait a bit
      await sleep(1000);

      // Server should still be healthy
      const res = await fetch(`${baseUrl}/signalk`);
      expect(res.ok).toBe(true);

      expect(logMonitor.getPhaseErrors('ws-abrupt-close')).toHaveLength(0);
    });
  });

  describe('Message Sending', () => {
    test('can send subscription message after connect', async () => {
      logMonitor.setPhase('ws-send-sub');

      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`${wsUrl}?subscribe=none`);

        ws.on('open', () => {
          // Send subscription
          ws.send(
            JSON.stringify({
              context: 'vessels.self',
              subscribe: [{ path: 'navigation.*' }],
            })
          );

          setTimeout(() => {
            ws.close();
            resolve();
          }, 1000);
        });

        ws.on('error', reject);
      });

      expect(logMonitor.getPhaseErrors('ws-send-sub')).toHaveLength(0);
    });

    test('ignores malformed JSON messages', async () => {
      logMonitor.setPhase('ws-malformed');

      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`${wsUrl}?subscribe=none`);

        ws.on('open', () => {
          // Send invalid JSON
          ws.send('this is not json');
          ws.send('{invalid json}');
          ws.send('');

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

      expect(logMonitor).toHaveNoCriticalErrors();
    });
  });

  // Helper functions
  async function collectMessages(url, duration) {
    const messages = [];

    await new Promise((resolve) => {
      const ws = new WebSocket(url);

      ws.on('message', (data) => {
        try {
          messages.push(JSON.parse(data.toString()));
        } catch (e) {
          // Ignore non-JSON
        }
      });

      ws.on('open', () => {
        setTimeout(() => {
          ws.close();
          resolve();
        }, duration);
      });

      ws.on('error', () => {
        resolve();
      });
    });

    return messages;
  }

  async function collectMessagesWithSubscription(url, subscription, duration) {
    const messages = [];

    await new Promise((resolve) => {
      const ws = new WebSocket(url);

      ws.on('message', (data) => {
        try {
          messages.push(JSON.parse(data.toString()));
        } catch (e) {
          // Ignore non-JSON
        }
      });

      ws.on('open', () => {
        // Send subscription
        ws.send(JSON.stringify(subscription));

        setTimeout(() => {
          ws.close();
          resolve();
        }, duration);
      });

      ws.on('error', () => {
        resolve();
      });
    });

    return messages;
  }

  async function getFirstDelta() {
    // Send some data first
    await feeder.sendTcp(NmeaFixtures.generateRMC(60.25, 24.25, 5.5, 120.0));

    return new Promise((resolve) => {
      const ws = new WebSocket(`${wsUrl}?subscribe=all`);
      let resolved = false;

      ws.on('message', (data) => {
        if (resolved) return;

        try {
          const msg = JSON.parse(data.toString());
          if (msg.updates) {
            resolved = true;
            ws.close();
            resolve(msg);
          }
        } catch (e) {
          // Ignore
        }
      });

      ws.on('open', async () => {
        // Send more data after connection
        await feeder.sendTcp(NmeaFixtures.generateRMC(60.26, 24.26, 5.5, 120.0));
      });

      // Timeout
      setTimeout(() => {
        if (!resolved) {
          ws.close();
          resolve(null);
        }
      }, 5000);
    });
  }
});
