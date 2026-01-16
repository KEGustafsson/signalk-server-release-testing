/**
 * Sustained Load Tests
 *
 * Tests server stability under continuous load over extended periods.
 * These tests run longer to detect memory leaks and stability issues.
 */

const { ContainerManager } = require('../lib/container-manager');
const { LogMonitor } = require('../lib/log-monitor');
const { NmeaFeeder } = require('../lib/nmea-feeder');
const { NmeaFixtures } = require('../lib/nmea-fixtures');
const WebSocket = require('ws');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// These tests have longer timeouts
jest.setTimeout(300000); // 5 minutes

describe('Sustained Load Tests', () => {
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
  }, 180000);

  afterAll(async () => {
    await manager.remove(true);
  });

  describe('Memory Stability', () => {
    test('memory usage remains stable over 2 minutes of continuous data', async () => {
      logMonitor.setPhase('sustained-memory');

      // Get initial memory
      const initialStats = await manager.getStats();
      const initialMemory = initialStats.memory.usage;

      const memorySamples = [initialMemory];
      const duration = 120000; // 2 minutes
      const interval = 10000; // Sample every 10 seconds
      const startTime = Date.now();

      // Start continuous data feed
      const feedInterval = setInterval(async () => {
        const sentences = NmeaFixtures.generateNavigationBurst(10);
        await feeder.sendTcp(sentences, { delay: 50 });
      }, 500);

      // Sample memory periodically
      const sampleInterval = setInterval(async () => {
        try {
          const stats = await manager.getStats();
          memorySamples.push(stats.memory.usage);
        } catch (e) {}
      }, interval);

      // Wait for test duration
      await sleep(duration);

      clearInterval(feedInterval);
      clearInterval(sampleInterval);

      // Get final memory
      const finalStats = await manager.getStats();
      const finalMemory = finalStats.memory.usage;

      // Calculate memory growth
      const memoryGrowth = finalMemory - initialMemory;
      const growthMB = memoryGrowth / 1024 / 1024;

      // Memory growth should be less than 100MB over 2 minutes
      expect(growthMB).toBeLessThan(100);

      expect(logMonitor).toHaveNoCriticalErrors();
    }, 180000);
  });

  describe('Connection Stability', () => {
    test('WebSocket connections remain stable over time', async () => {
      logMonitor.setPhase('sustained-ws');

      const ws = new WebSocket(`${wsUrl}?subscribe=all`);
      let messageCount = 0;
      let connectionDropped = false;

      ws.on('message', () => {
        messageCount++;
      });

      ws.on('close', () => {
        connectionDropped = true;
      });

      ws.on('error', () => {});

      await new Promise(r => ws.on('open', r));

      const duration = 60000; // 1 minute

      // Send data continuously
      const feedInterval = setInterval(async () => {
        const sentence = NmeaFixtures.generateRMC(60 + Math.random(), 24 + Math.random(), 10, 90);
        await feeder.sendTcp(sentence);
      }, 200);

      await sleep(duration);
      clearInterval(feedInterval);

      ws.close();

      expect(connectionDropped).toBe(false);
      expect(messageCount).toBeGreaterThan(10);

      expect(logMonitor).toHaveNoCriticalErrors();
    }, 120000);
  });

  describe('API Responsiveness', () => {
    test('REST API remains responsive under continuous load', async () => {
      logMonitor.setPhase('sustained-api');

      const duration = 60000; // 1 minute
      const startTime = Date.now();
      const responseTimes = [];
      let successCount = 0;
      let errorCount = 0;

      // Start data feed
      const feedInterval = setInterval(async () => {
        const sentences = NmeaFixtures.generateNavigationBurst(5);
        await feeder.sendTcp(sentences, { delay: 20 });
      }, 200);

      // Poll API continuously
      while (Date.now() - startTime < duration) {
        const reqStart = Date.now();
        try {
          const res = await fetch(`${baseUrl}/signalk/v1/api/vessels/self/navigation/position`);
          if (res.ok) {
            successCount++;
            responseTimes.push(Date.now() - reqStart);
          } else {
            errorCount++;
          }
        } catch (e) {
          errorCount++;
        }
        await sleep(100);
      }

      clearInterval(feedInterval);

      // Calculate statistics
      const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;

      // API should remain responsive (avg < 500ms)
      expect(avgResponseTime).toBeLessThan(500);
      // Error rate should be low
      expect(errorCount / (successCount + errorCount)).toBeLessThan(0.05);

      expect(logMonitor).toHaveNoCriticalErrors();
    }, 120000);
  });

  describe('Mixed Protocol Stability', () => {
    test('handles mixed TCP/UDP input for extended period', async () => {
      logMonitor.setPhase('sustained-mixed');

      const duration = 60000; // 1 minute
      let tcpCount = 0;
      let udpCount = 0;

      // TCP feed
      const tcpInterval = setInterval(async () => {
        const sentence = NmeaFixtures.generateRMC(60 + Math.random() * 0.1, 24 + Math.random() * 0.1, 10, 90);
        await feeder.sendTcp(sentence);
        tcpCount++;
      }, 100);

      // UDP feed
      const udpInterval = setInterval(async () => {
        const sentence = NmeaFixtures.generateDBT(10 + Math.random() * 5);
        await feeder.sendUdp(sentence);
        udpCount++;
      }, 150);

      await sleep(duration);

      clearInterval(tcpInterval);
      clearInterval(udpInterval);

      // Verify server still responsive
      const res = await fetch(`${baseUrl}/signalk`);
      expect(res.ok).toBe(true);

      expect(logMonitor).toHaveNoCriticalErrors();
    }, 120000);
  });

  describe('Recovery After Load', () => {
    test('server recovers after burst load', async () => {
      logMonitor.setPhase('sustained-recovery');

      // Get baseline
      const baselineRes = await fetch(`${baseUrl}/signalk`);
      expect(baselineRes.ok).toBe(true);

      // Apply heavy burst load
      const burstPromises = [];
      for (let i = 0; i < 10; i++) {
        burstPromises.push(
          feeder.sendTcp(NmeaFixtures.getTestDataBurst(100), { delay: 5 })
        );
      }
      await Promise.all(burstPromises);

      // Wait for processing
      await sleep(5000);

      // Verify recovery
      const recoveryRes = await fetch(`${baseUrl}/signalk`);
      expect(recoveryRes.ok).toBe(true);

      // API should still be responsive
      const start = Date.now();
      const posRes = await fetch(`${baseUrl}/signalk/v1/api/vessels/self/navigation/position`);
      const responseTime = Date.now() - start;

      expect(responseTime).toBeLessThan(1000);

      expect(logMonitor).toHaveNoCriticalErrors();
    });
  });

  describe('Log Monitoring', () => {
    test('no error accumulation over time', async () => {
      logMonitor.setPhase('sustained-logs');

      const duration = 30000; // 30 seconds
      const startErrors = logMonitor.errors.length;

      // Normal operation
      const feedInterval = setInterval(async () => {
        const sentence = NmeaFixtures.generateRMC(60, 24, 10, 90);
        await feeder.sendTcp(sentence);
      }, 500);

      await sleep(duration);
      clearInterval(feedInterval);

      const endErrors = logMonitor.errors.length;
      const newErrors = endErrors - startErrors;

      // Should have minimal errors during normal operation
      expect(newErrors).toBeLessThan(5);

      expect(logMonitor).toHaveNoCriticalErrors();
    });
  });
});
