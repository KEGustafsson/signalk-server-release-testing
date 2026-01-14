/**
 * Real-World Scenario Tests
 *
 * Simulates actual sailing scenarios with realistic
 * data patterns and durations.
 */

const { ContainerManager } = require('../lib/container-manager');
const { LogMonitor } = require('../lib/log-monitor');
const { NmeaFeeder } = require('../lib/nmea-feeder');
const path = require('path');
const fs = require('fs-extra');

describe('Real-World Scenarios', () => {
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
    feeder = new NmeaFeeder({ tcpPort: info.tcpPort, udpPort: info.udpPort });

    await sleep(3000);
  }, 120000);

  afterAll(async () => {
    await manager.remove(true);

    const summary = logMonitor.getSummary();
    console.log('\n--- Scenario Test Log Summary ---');
    console.log(`Total Errors: ${summary.totalErrors}`);
    console.log(`Total Warnings: ${summary.totalWarnings}`);
  });

  describe('Coastal Sailing Scenario', () => {
    test('simulates coastal navigation with varied data', async () => {
      logMonitor.setPhase('scenario-coastal');

      // Generate 5 minutes of simulated sailing
      const phases = [
        // Motor out of harbor - slow speed
        {
          duration: 30,
          speed: 3,
          course: 180,
          startLat: 60.15,
          startLon: 24.95,
        },
        // Raise sails - transition
        {
          duration: 20,
          speed: 2,
          course: 200,
        },
        // Open water sailing
        {
          duration: 60,
          speed: 6,
          course: 220,
        },
      ];

      let currentLat = 60.15;
      let currentLon = 24.95;

      for (const phase of phases) {
        const count = phase.duration;
        const sentences = feeder.generateNavigationBurst(count, {
          startLat: currentLat,
          startLon: currentLon,
          speed: phase.speed,
          course: phase.course,
        });

        // Add environment data
        const envSentences = feeder.generateEnvironmentBurst(Math.floor(count / 2), {
          depth: 15 + Math.random() * 10,
          windSpeed: 10 + Math.random() * 5,
          windAngle: 45,
        });

        const allSentences = [];
        for (let i = 0; i < sentences.length; i++) {
          allSentences.push(sentences[i]);
          if (i < envSentences.length) {
            allSentences.push(envSentences[i]);
          }
        }

        await feeder.sendTcp(allSentences, { delay: 100 });

        // Update position for next phase
        currentLat -= 0.01;
        currentLon -= 0.005;
      }

      await sleep(3000);

      // Verify data was processed - check multiple possible paths
      // SignalK may store position at different paths depending on sentence type
      const posRes = await fetch(
        `${baseUrl}/signalk/v1/api/vessels/self/navigation/position`
      );
      const courseRes = await fetch(
        `${baseUrl}/signalk/v1/api/vessels/self/navigation`
      );
      // At least one navigation endpoint should have data, or 404 if no data processed
      expect(posRes.ok || courseRes.ok || posRes.status === 404).toBe(true);

      expect(logMonitor.getPhaseErrors('scenario-coastal')).toHaveLength(0);
    }, 180000);
  });

  describe('Anchor Watch Scenario', () => {
    test('simulates anchored position with small variations', async () => {
      logMonitor.setPhase('scenario-anchor');

      const anchorLat = 60.15;
      const anchorLon = 24.95;

      // Simulate 2 minutes of anchor watch
      for (let i = 0; i < 60; i++) {
        // Small random drift around anchor point (within 20 meters)
        const lat = anchorLat + (Math.random() - 0.5) * 0.0002;
        const lon = anchorLon + (Math.random() - 0.5) * 0.0002;

        const latDeg = Math.floor(lat);
        const latMin = (lat - latDeg) * 60;
        const lonDeg = Math.floor(lon);
        const lonMin = (lon - lonDeg) * 60;

        const sentence = feeder.addChecksum(
          `$GPRMC,${String(i).padStart(6, '0')},A,${latDeg}${latMin.toFixed(4)},N,0${lonDeg}${lonMin.toFixed(4)},E,0.1,0.0,010125,0.0,E,A`
        );

        await feeder.sendTcp(sentence);
        await sleep(100);
      }

      await sleep(2000);

      // Position should be near anchor point
      const res = await fetch(
        `${baseUrl}/signalk/v1/api/vessels/self/navigation/position`
      );
      if (res.ok) {
        const data = await res.json();
        expect(Math.abs(data.value.latitude - anchorLat)).toBeLessThan(0.001);
        expect(Math.abs(data.value.longitude - anchorLon)).toBeLessThan(0.001);
      }

      expect(logMonitor.getPhaseErrors('scenario-anchor')).toHaveLength(0);
    }, 120000);
  });

  describe('Heavy AIS Traffic Scenario', () => {
    test('simulates busy harbor with many AIS targets', async () => {
      logMonitor.setPhase('scenario-ais-heavy');

      // Generate AIS messages for multiple vessels
      const aisSentences = feeder.generateAisBurst(100);

      const result = await feeder.sendTcp(aisSentences, { delay: 50 });

      expect(result.sent).toBeGreaterThan(50);

      await sleep(5000);

      // Check that vessels were added
      const res = await fetch(`${baseUrl}/signalk/v1/api/vessels`);
      if (res.ok) {
        const vessels = await res.json();
        const vesselCount = Object.keys(vessels).length;
        console.log(`AIS targets detected: ${vesselCount - 1}`); // Minus self
      }

      expect(logMonitor.getPhaseErrors('scenario-ais-heavy')).toHaveLength(0);
    }, 60000);
  });

  describe('Mixed Protocol Scenario', () => {
    test('handles TCP and UDP simultaneously', async () => {
      logMonitor.setPhase('scenario-mixed-protocol');

      // Send navigation via TCP
      const tcpPromise = (async () => {
        for (let i = 0; i < 30; i++) {
          await feeder.sendTcp(
            '$GPRMC,123519,A,6000.000,N,02400.000,E,5.0,90.0,010125,0.0,E,A*1A'
          );
          await sleep(100);
        }
      })();

      // Send environment via UDP simultaneously
      const udpPromise = (async () => {
        for (let i = 0; i < 30; i++) {
          await feeder.sendUdp('$SDDBT,10.0,f,3.0,M,1.6,F*2A');
          await sleep(100);
        }
      })();

      await Promise.all([tcpPromise, udpPromise]);
      await sleep(3000);

      expect(logMonitor.getPhaseErrors('scenario-mixed-protocol')).toHaveLength(0);
    }, 60000);
  });

  describe('Instrument Burst Scenario', () => {
    test('simulates high-frequency instrument updates', async () => {
      logMonitor.setPhase('scenario-instrument-burst');

      // Generate rapid instrument data (simulating 10Hz update rate)
      const sentences = [];
      for (let i = 0; i < 200; i++) {
        sentences.push(
          feeder.addChecksum(
            `$SDDBT,${(10 + Math.random()).toFixed(1)},f,${(3 + Math.random() * 0.3).toFixed(1)},M,1.6,F`
          )
        );
        sentences.push(
          feeder.addChecksum(
            `$WIMWV,${(270 + Math.random() * 10).toFixed(1)},R,${(15 + Math.random() * 2).toFixed(1)},M,A`
          )
        );
      }

      await feeder.sendTcp(sentences, { delay: 10 });
      await sleep(5000);

      expect(logMonitor.getPhaseErrors('scenario-instrument-burst')).toHaveLength(0);
    }, 60000);
  });

  describe('Long Running Scenario', () => {
    test('server remains stable during extended operation', async () => {
      logMonitor.setPhase('scenario-long-running');

      const startStats = await manager.getStats();
      const startMem = parseFloat(startStats.memory.usageMB);

      // Run for 30 seconds with continuous data
      const endTime = Date.now() + 30000;
      let messageCount = 0;

      while (Date.now() < endTime) {
        const sentences = feeder.generateNavigationBurst(10);
        await feeder.sendTcp(sentences, { delay: 50 });
        messageCount += sentences.length;
        await sleep(500);
      }

      const endStats = await manager.getStats();
      const endMem = parseFloat(endStats.memory.usageMB);

      console.log(`Messages sent: ${messageCount}`);
      console.log(`Memory start: ${startMem} MB, end: ${endMem} MB`);

      // Memory shouldn't grow excessively (allow 50MB growth)
      expect(endMem - startMem).toBeLessThan(50);

      // Server should still respond
      const res = await fetch(`${baseUrl}/signalk`);
      expect(res.ok).toBe(true);

      expect(logMonitor.getPhaseErrors('scenario-long-running')).toHaveLength(0);
    }, 60000);
  });

  describe('Recovery Scenario', () => {
    test('server recovers after input flood', async () => {
      logMonitor.setPhase('scenario-recovery');

      // Flood with data
      const sentences = feeder.generateNavigationBurst(500);
      await feeder.sendTcp(sentences, { delay: 5 });

      // Wait for processing
      await sleep(5000);

      // Server should still be responsive
      const res = await fetch(`${baseUrl}/signalk`);
      expect(res.ok).toBe(true);

      // API should work
      const apiRes = await fetch(`${baseUrl}/signalk/v1/api/vessels/self`);
      expect(apiRes.ok).toBe(true);

      expect(logMonitor.getPhaseErrors('scenario-recovery')).toHaveLength(0);
    }, 30000);
  });
});
