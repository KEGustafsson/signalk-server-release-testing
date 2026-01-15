/**
 * Stress Tests
 *
 * Tests SignalK server under high load conditions
 */

const { ContainerManager } = require('../lib/container-manager');
const { LogMonitor } = require('../lib/log-monitor');
const { NmeaFeeder } = require('../lib/nmea-feeder');
const { NmeaFixtures } = require('../lib/nmea-fixtures');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('Stress Tests', () => {
  let manager;
  let logMonitor;
  let feeder;
  let baseUrl;

  beforeAll(async () => {
    logMonitor = new LogMonitor();
    manager = new ContainerManager({
      image: process.env.SIGNALK_IMAGE || 'signalk/signalk-server:latest',
      logMonitor,
    });
    const info = await manager.start();
    baseUrl = info.baseUrl;

    feeder = new NmeaFeeder({
      tcpPort: info.tcpPort,
      udpPort: info.udpPort,
    });
  }, 120000);

  afterAll(async () => {
    await manager.remove(true);

    const summary = logMonitor.getSummary();
    console.log('\n--- Stress Test Log Summary ---');
    console.log(`Total Errors: ${summary.totalErrors}`);
    console.log(`Total Warnings: ${summary.totalWarnings}`);
  });

  describe('High Volume Data', () => {
    test('handles 1000 realistic messages without errors', async () => {
      logMonitor.setPhase('stress-volume');

      // Use realistic test data from file - repeat to reach 1000 messages
      const messages = NmeaFixtures.getTestDataBurst(1000);
      console.log(`Sending ${messages.length} realistic NMEA messages...`);

      await feeder.sendTcp(messages, { delay: 10 });
      await sleep(5000);

      expect(logMonitor.getPhaseErrors('stress-volume')).toHaveLength(0);

      // Verify server is still responsive
      const res = await fetch(`${baseUrl}/signalk`);
      expect(res.ok).toBe(true);
    }, 120000);
  });

  describe('Rapid Connections', () => {
    test('handles multiple simultaneous TCP connections', async () => {
      logMonitor.setPhase('stress-connections');

      // Get sentences from test file for each connection
      const allSentences = NmeaFixtures.getAllTestSentences();

      const connectionPromises = [];
      for (let i = 0; i < 10; i++) {
        const tmpFeeder = new NmeaFeeder({ tcpPort: feeder.tcpPort });
        // Each connection sends different sentences from the test file
        const startIdx = (i * 5) % allSentences.length;
        const sentences = allSentences.slice(startIdx, startIdx + 5);
        connectionPromises.push(tmpFeeder.sendTcp(sentences.length > 0 ? sentences : allSentences.slice(0, 5)));
      }

      await Promise.all(connectionPromises);
      await sleep(3000);

      expect(logMonitor.getPhaseErrors('stress-connections')).toHaveLength(0);

      // Verify server is still responsive
      const res = await fetch(`${baseUrl}/signalk`);
      expect(res.ok).toBe(true);
    }, 60000);
  });

  describe('Memory Stability', () => {
    test('memory usage remains stable during sustained load', async () => {
      logMonitor.setPhase('stress-memory');

      const initialStats = await manager.getStats();
      const initialMemory = initialStats?.memory?.usage || 0;

      // Use realistic test data from file
      const testSentences = NmeaFixtures.getAllTestSentences();

      // Send data continuously for 30 seconds
      const endTime = Date.now() + 30000;
      let messageCount = 0;
      let sentenceIndex = 0;

      while (Date.now() < endTime) {
        // Send 3 sentences at a time from test file, cycling through
        const batch = [];
        for (let i = 0; i < 3; i++) {
          batch.push(testSentences[sentenceIndex % testSentences.length]);
          sentenceIndex++;
        }
        await feeder.sendTcp(batch);
        messageCount += batch.length;
        await sleep(100);
      }

      await sleep(5000);

      const finalStats = await manager.getStats();
      const finalMemory = finalStats?.memory?.usage || 0;

      console.log(`Messages sent: ${messageCount} realistic NMEA sentences`);
      console.log(
        `Memory: ${(initialMemory / 1024 / 1024).toFixed(2)} MB -> ${(finalMemory / 1024 / 1024).toFixed(2)} MB`
      );

      // Memory should not grow excessively (allow 50% growth)
      if (initialMemory > 0 && finalMemory > 0) {
        const memoryGrowth = finalMemory / initialMemory;
        expect(memoryGrowth).toBeLessThan(1.5);
      }

      expect(logMonitor.getPhaseErrors('stress-memory')).toHaveLength(0);
    }, 120000);
  });

  describe('CPU Stability', () => {
    test('CPU usage remains reasonable under load', async () => {
      logMonitor.setPhase('stress-cpu');

      // Use realistic test data for load generation
      const testSentences = NmeaFixtures.getTestDataBurst(500);
      console.log(`Sending ${testSentences.length} sentences for CPU load test...`);

      await feeder.sendTcp(testSentences, { delay: 0 });

      await sleep(5000);

      const stats = await manager.getStats();
      const cpuPercent = parseFloat(stats?.cpu?.percent || 0);

      console.log(`CPU usage: ${cpuPercent}%`);

      // CPU should not be pegged at 100%
      expect(cpuPercent).toBeLessThan(90);

      expect(logMonitor.getPhaseErrors('stress-cpu')).toHaveLength(0);
    }, 60000);
  });

  describe('Recovery', () => {
    test('server recovers after burst overload', async () => {
      logMonitor.setPhase('stress-recovery');

      // Send a massive burst of realistic test data
      const burst = NmeaFixtures.getTestDataBurst(500);
      console.log(`Sending burst of ${burst.length} realistic sentences...`);
      await feeder.sendTcp(burst, { delay: 1 });

      await sleep(10000);

      // Verify server recovered and is responsive
      const res = await fetch(`${baseUrl}/signalk`);
      expect(res.ok).toBe(true);

      // Verify no critical errors
      const errors = logMonitor.getPhaseErrors('stress-recovery');
      const criticalErrors = errors.filter(
        (e) => e.line.includes('fatal') || e.line.includes('crash')
      );
      expect(criticalErrors).toHaveLength(0);
    }, 60000);
  });
});
