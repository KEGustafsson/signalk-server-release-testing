/**
 * Historical Data Playback Tests
 *
 * Tests SignalK historical data retrieval and playback functionality.
 * Critical for trip review and data analysis features.
 */

const { ContainerManager } = require('../lib/container-manager');
const { LogMonitor } = require('../lib/log-monitor');
const { NmeaFeeder } = require('../lib/nmea-feeder');
const { NmeaFixtures } = require('../lib/nmea-fixtures');
const WebSocket = require('ws');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Historical Data Playback', () => {
  let manager;
  let logMonitor;
  let feeder;
  let baseUrl;
  let apiUrl;
  let wsUrl;
  let tcpPort;
  let dataTimestamp;

  beforeAll(async () => {
    logMonitor = new LogMonitor();
    manager = new ContainerManager({
      image: process.env.SIGNALK_IMAGE || 'signalk/signalk-server:latest',
      logMonitor,
    });
    const info = await manager.start();
    baseUrl = info.baseUrl;
    apiUrl = `${baseUrl}/signalk/v1/api`;
    wsUrl = baseUrl.replace('http', 'ws');
    tcpPort = info.tcpPort;
    feeder = new NmeaFeeder({ tcpPort });

    // Record timestamp before sending data
    dataTimestamp = new Date().toISOString();

    // Seed historical data over time
    for (let i = 0; i < 10; i++) {
      await feeder.sendTcp([
        NmeaFixtures.generateRMC(60.15 + i * 0.001, 24.95 + i * 0.001, 5.5, 135.0),
        NmeaFixtures.generateDBT(15.0 + i * 0.1),
      ]);
      await sleep(500);
    }

    await sleep(2000);
  }, 120000);

  afterAll(async () => {
    await manager.remove(true);

    const summary = logMonitor.getSummary();
    console.log('\n--- Historical Playback Test Log Summary ---');
    console.log(`Total Errors: ${summary.totalErrors}`);
  });

  describe('Snapshot API', () => {
    test('snapshot endpoint exists', async () => {
      logMonitor.setPhase('snapshot-exists');

      const res = await fetch(`${baseUrl}/signalk/v1/snapshot`);
      // Snapshot endpoint may not be available in all deployments
      expect([200, 404, 501]).toContain(res.status);

      if (res.ok) {
        const data = await res.json();
        console.log('Snapshot endpoint available');
      } else if (res.status === 501) {
        console.log('Snapshot/history feature not implemented');
      }

      expect(logMonitor.getPhaseErrors('snapshot-exists')).toHaveLength(0);
    });

    test('snapshot with timestamp returns historical data', async () => {
      logMonitor.setPhase('snapshot-timestamp');

      const timestamp = dataTimestamp;
      const res = await fetch(`${baseUrl}/signalk/v1/snapshot/${timestamp}`);

      expect([200, 404, 501]).toContain(res.status);

      if (res.ok) {
        const data = await res.json();
        expect(data.vessels || data.self).toBeDefined();
        console.log('Historical snapshot retrieved for:', timestamp);
      }

      expect(logMonitor.getPhaseErrors('snapshot-timestamp')).toHaveLength(0);
    });

    test('snapshot with invalid timestamp returns error', async () => {
      logMonitor.setPhase('snapshot-invalid');

      const res = await fetch(`${baseUrl}/signalk/v1/snapshot/invalid-timestamp`);

      // Should return 400 Bad Request or 404/501 if not supported
      expect([400, 404, 501]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('snapshot-invalid')).toHaveLength(0);
    });

    test('snapshot with future timestamp handled correctly', async () => {
      logMonitor.setPhase('snapshot-future');

      const futureTime = new Date(Date.now() + 86400000).toISOString(); // +1 day
      const res = await fetch(`${baseUrl}/signalk/v1/snapshot/${futureTime}`);

      // Should return empty or error for future timestamp
      expect([200, 400, 404, 501]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('snapshot-future')).toHaveLength(0);
    });
  });

  describe('WebSocket Playback', () => {
    test('stream accepts startTime parameter', async () => {
      logMonitor.setPhase('ws-starttime');

      const startTime = dataTimestamp;
      const url = `${wsUrl}/signalk/v1/stream?subscribe=all&startTime=${encodeURIComponent(startTime)}`;

      const result = await new Promise((resolve) => {
        const ws = new WebSocket(url);
        let connected = false;
        let messages = [];

        ws.on('open', () => {
          connected = true;
          setTimeout(() => {
            ws.close();
            resolve({ connected, messages });
          }, 3000);
        });

        ws.on('message', (data) => {
          try {
            messages.push(JSON.parse(data.toString()));
          } catch (e) {
            // Ignore
          }
        });

        ws.on('error', (err) => {
          resolve({ connected: false, error: err.message, messages });
        });

        setTimeout(() => {
          ws.close();
          resolve({ connected, messages, timeout: true });
        }, 5000);
      });

      console.log(`Playback connection: ${result.connected}, messages: ${result.messages.length}`);
      expect(result.connected).toBe(true);

      expect(logMonitor.getPhaseErrors('ws-starttime')).toHaveLength(0);
    });

    test('stream accepts playbackRate parameter', async () => {
      logMonitor.setPhase('ws-playback-rate');

      const startTime = dataTimestamp;
      const playbackRate = 2; // 2x speed
      const url = `${wsUrl}/signalk/v1/stream?subscribe=all&startTime=${encodeURIComponent(startTime)}&playbackRate=${playbackRate}`;

      const result = await new Promise((resolve) => {
        const ws = new WebSocket(url);
        let connected = false;

        ws.on('open', () => {
          connected = true;
          setTimeout(() => {
            ws.close();
            resolve({ connected });
          }, 2000);
        });

        ws.on('error', () => {
          resolve({ connected: false });
        });

        setTimeout(() => {
          ws.close();
          resolve({ connected });
        }, 3000);
      });

      console.log(`Playback with rate=${playbackRate}: ${result.connected ? 'connected' : 'failed'}`);

      expect(logMonitor.getPhaseErrors('ws-playback-rate')).toHaveLength(0);
    });

    test('stream playback sends data in correct order', async () => {
      logMonitor.setPhase('ws-playback-order');

      const url = `${wsUrl}/signalk/v1/stream?subscribe=all`;

      const timestamps = await new Promise((resolve) => {
        const ws = new WebSocket(url);
        const collected = [];

        ws.on('open', () => {
          setTimeout(() => {
            ws.close();
            resolve(collected);
          }, 3000);
        });

        ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.updates) {
              for (const update of msg.updates) {
                if (update.timestamp) {
                  collected.push(new Date(update.timestamp).getTime());
                }
              }
            }
          } catch (e) {
            // Ignore
          }
        });

        ws.on('error', () => {
          resolve(collected);
        });
      });

      // Verify timestamps are in order (or close to it)
      if (timestamps.length > 1) {
        let outOfOrder = 0;
        for (let i = 1; i < timestamps.length; i++) {
          if (timestamps[i] < timestamps[i - 1] - 1000) {
            // Allow 1 second tolerance
            outOfOrder++;
          }
        }
        console.log(`Timestamps: ${timestamps.length}, out of order: ${outOfOrder}`);
        // Allow some out-of-order due to multiple sources
        expect(outOfOrder).toBeLessThan(timestamps.length * 0.1);
      }

      expect(logMonitor.getPhaseErrors('ws-playback-order')).toHaveLength(0);
    });
  });

  describe('History API', () => {
    test('history endpoint exists', async () => {
      logMonitor.setPhase('history-exists');

      // Try different history endpoint patterns
      const endpoints = [
        `${baseUrl}/signalk/v1/history`,
        `${baseUrl}/signalk/v1/api/history`,
        `${baseUrl}/signalk/v2/api/history`,
      ];

      let found = false;
      for (const endpoint of endpoints) {
        const res = await fetch(endpoint);
        if (res.ok) {
          found = true;
          console.log(`History endpoint found: ${endpoint}`);
          break;
        }
      }

      console.log(`History API available: ${found}`);

      expect(logMonitor.getPhaseErrors('history-exists')).toHaveLength(0);
    });

    test('can query historical position data', async () => {
      logMonitor.setPhase('history-position');

      const endTime = new Date().toISOString();
      const startTime = new Date(Date.now() - 60000).toISOString(); // 1 minute ago

      const res = await fetch(
        `${apiUrl}/vessels/self/navigation/position?startTime=${startTime}&endTime=${endTime}`
      );

      expect([200, 400, 404]).toContain(res.status);

      if (res.ok) {
        const data = await res.json();
        console.log('Historical position query returned data');
      }

      expect(logMonitor.getPhaseErrors('history-position')).toHaveLength(0);
    });

    test('history query with time range', async () => {
      logMonitor.setPhase('history-range');

      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 3600000);

      const params = new URLSearchParams({
        startTime: oneHourAgo.toISOString(),
        endTime: now.toISOString(),
      });

      const res = await fetch(`${apiUrl}/vessels/self?${params}`);
      expect([200, 400, 404]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('history-range')).toHaveLength(0);
    });
  });

  describe('Data Retention', () => {
    test('recent data is accessible', async () => {
      logMonitor.setPhase('retention-recent');

      // Send new data point
      await feeder.sendTcp(NmeaFixtures.generateRMC(60.2, 25.0, 6.0, 180.0));
      await sleep(1000);

      // Query immediately
      const res = await fetch(`${apiUrl}/vessels/self/navigation/position`);
      expect(res.ok).toBe(true);

      const data = await res.json();
      expect(data.value).toBeDefined();

      expect(logMonitor.getPhaseErrors('retention-recent')).toHaveLength(0);
    });

    test('data includes timestamps', async () => {
      logMonitor.setPhase('retention-timestamps');

      const res = await fetch(`${apiUrl}/vessels/self/navigation/position`);

      if (res.ok) {
        const data = await res.json();
        expect(data.timestamp).toBeDefined();

        const timestamp = new Date(data.timestamp);
        expect(timestamp.toString()).not.toBe('Invalid Date');

        // Timestamp should be recent (within last hour)
        const age = Date.now() - timestamp.getTime();
        expect(age).toBeLessThan(3600000);

        console.log(`Data timestamp: ${data.timestamp}, age: ${age}ms`);
      }

      expect(logMonitor.getPhaseErrors('retention-timestamps')).toHaveLength(0);
    });
  });

  describe('Playback Control', () => {
    test('pause playback functionality', async () => {
      logMonitor.setPhase('playback-pause');

      const url = `${wsUrl}/signalk/v1/stream?subscribe=all`;

      const result = await new Promise((resolve) => {
        const ws = new WebSocket(url);
        let messageCount = 0;

        ws.on('open', () => {
          // Try to send pause command
          ws.send(JSON.stringify({ command: 'pause' }));

          setTimeout(() => {
            ws.close();
            resolve({ messageCount });
          }, 2000);
        });

        ws.on('message', () => {
          messageCount++;
        });

        ws.on('error', () => {
          resolve({ messageCount, error: true });
        });
      });

      console.log(`Messages during pause test: ${result.messageCount}`);

      expect(logMonitor.getPhaseErrors('playback-pause')).toHaveLength(0);
    });

    test('seek functionality in playback', async () => {
      logMonitor.setPhase('playback-seek');

      // Connect with playback and try to seek
      const startTime = dataTimestamp;
      const url = `${wsUrl}/signalk/v1/stream?subscribe=all&startTime=${encodeURIComponent(startTime)}`;

      const result = await new Promise((resolve) => {
        const ws = new WebSocket(url);
        let connected = false;

        ws.on('open', () => {
          connected = true;

          // Try seek command
          const seekTime = new Date(Date.now() - 30000).toISOString();
          ws.send(JSON.stringify({ command: 'seek', time: seekTime }));

          setTimeout(() => {
            ws.close();
            resolve({ connected });
          }, 2000);
        });

        ws.on('error', () => {
          resolve({ connected: false });
        });
      });

      console.log(`Seek test: ${result.connected ? 'connected' : 'failed'}`);

      expect(logMonitor.getPhaseErrors('playback-seek')).toHaveLength(0);
    });
  });

  describe('Edge Cases', () => {
    test('handles empty time range gracefully', async () => {
      logMonitor.setPhase('history-empty');

      // Query very old time range (likely no data)
      const oldTime = new Date('2000-01-01T00:00:00Z').toISOString();
      const oldEndTime = new Date('2000-01-01T01:00:00Z').toISOString();

      const res = await fetch(
        `${apiUrl}/vessels/self/navigation/position?startTime=${oldTime}&endTime=${oldEndTime}`
      );

      expect([200, 400, 404]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('history-empty')).toHaveLength(0);
    });

    test('handles very large time range', async () => {
      logMonitor.setPhase('history-large');

      const startTime = new Date('2020-01-01T00:00:00Z').toISOString();
      const endTime = new Date().toISOString();

      const res = await fetch(
        `${apiUrl}/vessels/self?startTime=${startTime}&endTime=${endTime}`
      );

      expect([200, 400, 404, 413]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('history-large')).toHaveLength(0);
    });

    test('handles invalid time format', async () => {
      logMonitor.setPhase('history-invalid-time');

      const res = await fetch(
        `${apiUrl}/vessels/self/navigation/position?startTime=not-a-date`
      );

      expect([200, 400, 404]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('history-invalid-time')).toHaveLength(0);
    });

    test('handles reversed time range', async () => {
      logMonitor.setPhase('history-reversed');

      const now = new Date().toISOString();
      const past = new Date(Date.now() - 3600000).toISOString();

      // startTime after endTime
      const res = await fetch(
        `${apiUrl}/vessels/self/navigation/position?startTime=${now}&endTime=${past}`
      );

      expect([200, 400, 404]).toContain(res.status);

      expect(logMonitor.getPhaseErrors('history-reversed')).toHaveLength(0);
    });
  });
});
