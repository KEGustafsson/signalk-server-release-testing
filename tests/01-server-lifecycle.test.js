/**
 * Server Lifecycle Tests
 *
 * Tests server start, stop, restart, and crash recovery
 * with continuous log monitoring for errors.
 */

const { ContainerManager } = require('../lib/container-manager');
const { LogMonitor } = require('../lib/log-monitor');

describe('Server Lifecycle', () => {
  let manager;
  let logMonitor;

  beforeAll(async () => {
    logMonitor = new LogMonitor();
    manager = new ContainerManager({
      image: process.env.SIGNALK_IMAGE || 'signalk/signalk-server:latest',
      logMonitor,
    });
  });

  afterAll(async () => {
    await manager.remove(true);
    
    // Output log summary
    const summary = logMonitor.getSummary();
    console.log('\n--- Lifecycle Test Log Summary ---');
    console.log(`Total Errors: ${summary.totalErrors}`);
    console.log(`Total Warnings: ${summary.totalWarnings}`);
    if (summary.criticalPhases.length > 0) {
      console.log(`Critical Phases: ${summary.criticalPhases.join(', ')}`);
    }
  });

  describe('Fresh Start', () => {
    test('starts from clean state without errors', async () => {
      logMonitor.setPhase('fresh-start');

      const info = await manager.start();

      expect(info.baseUrl).toBeDefined();
      expect(info.apiUrl).toBeDefined();

      // Verify server responds
      const res = await fetch(`${info.baseUrl}/signalk`);
      expect(res.ok).toBe(true);

      const data = await res.json();
      expect(data.endpoints).toBeDefined();
      expect(data.endpoints.v1).toBeDefined();

      // Check logs for errors
      expect(logMonitor).toHaveNoErrors();
    }, 120000);

    test('API endpoints respond correctly', async () => {
      logMonitor.setPhase('api-check');
      
      const info = manager.getConnectionInfo();

      // Test various endpoints
      const endpoints = [
        '/signalk',
        '/signalk/v1/api',
        '/signalk/v1/api/vessels/self',
      ];

      for (const endpoint of endpoints) {
        const res = await fetch(`${info.baseUrl}${endpoint}`);
        expect(res.ok).toBe(true);
      }

      expect(logMonitor.getPhaseErrors('api-check')).toHaveLength(0);
    });

    test('WebSocket endpoint accepts connections', async () => {
      logMonitor.setPhase('websocket-check');
      
      const info = manager.getConnectionInfo();
      const WebSocket = require('ws');

      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`${info.wsUrl}?subscribe=none`);
        
        ws.on('open', () => {
          ws.close();
          resolve();
        });

        ws.on('error', reject);

        setTimeout(() => {
          ws.close();
          reject(new Error('WebSocket connection timeout'));
        }, 10000);
      });

      expect(logMonitor.getPhaseErrors('websocket-check')).toHaveLength(0);
    });
  });

  describe('Graceful Shutdown', () => {
    test('stops gracefully without errors', async () => {
      logMonitor.setPhase('graceful-shutdown');

      await manager.stop(10);

      // Wait a moment for logs to flush
      await sleep(2000);

      // Check for clean shutdown
      const status = await manager.getStatus();
      expect(status?.running).toBeFalsy();

      // Check logs for shutdown errors
      const report = logMonitor.getPhaseReport('graceful-shutdown');
      expect(report.errors).toHaveLength(0);
    }, 30000);
  });

  describe('Restart with Existing Data', () => {
    test('restarts and loads existing configuration', async () => {
      logMonitor.setPhase('restart-existing');

      const info = await manager.start();

      expect(info.baseUrl).toBeDefined();

      // Server should start faster with existing config
      const res = await fetch(`${info.baseUrl}/signalk`);
      expect(res.ok).toBe(true);

      expect(logMonitor.getPhaseErrors('restart-existing')).toHaveLength(0);
    }, 60000);

    test('data directory persists across restarts', async () => {
      logMonitor.setPhase('data-persistence');
      
      const info = manager.getConnectionInfo();

      // Check that settings file exists
      const fs = require('fs-extra');
      const settingsPath = `${info.dataDir}/settings.json`;
      
      expect(await fs.pathExists(settingsPath)).toBe(true);

      expect(logMonitor.getPhaseErrors('data-persistence')).toHaveLength(0);
    });
  });

  describe('Restart Command', () => {
    test('handles restart command without errors', async () => {
      logMonitor.setPhase('restart-command');

      await manager.restart(10);

      const info = manager.getConnectionInfo();
      const res = await fetch(`${info.baseUrl}/signalk`);
      expect(res.ok).toBe(true);

      expect(logMonitor.getPhaseErrors('restart-command')).toHaveLength(0);
    }, 60000);
  });

  describe('Crash Recovery', () => {
    test('recovers from SIGKILL without data corruption', async () => {
      logMonitor.setPhase('crash-recovery');

      // Simulate crash
      await manager.kill('SIGKILL');

      // Wait for container to stop
      await sleep(2000);

      // Restart
      const info = await manager.start();

      // Server should start successfully
      const res = await fetch(`${info.baseUrl}/signalk`);
      expect(res.ok).toBe(true);

      // Check for corruption errors
      const report = logMonitor.getPhaseReport('crash-recovery');
      const corruptionErrors = report.errors.filter((e) =>
        /corrupt|invalid|damaged|broken/i.test(e.line)
      );
      expect(corruptionErrors).toHaveLength(0);
    }, 120000);

    test('recovers from SIGTERM correctly', async () => {
      logMonitor.setPhase('sigterm-recovery');

      // Send SIGTERM
      await manager.kill('SIGTERM');

      // Wait for graceful shutdown
      await sleep(5000);

      // Restart
      const info = await manager.start();

      const res = await fetch(`${info.baseUrl}/signalk`);
      expect(res.ok).toBe(true);

      expect(logMonitor.getPhaseErrors('sigterm-recovery')).toHaveLength(0);
    }, 120000);
  });

  describe('Resource Usage', () => {
    test('memory usage is reasonable after start', async () => {
      logMonitor.setPhase('resource-check');

      const stats = await manager.getStats();
      
      expect(stats).toBeDefined();
      expect(stats.memory).toBeDefined();

      // Memory should be under 512MB for basic operation
      const memMB = parseFloat(stats.memory.usageMB);
      expect(memMB).toBeLessThan(512);

      console.log(`Memory usage: ${stats.memory.usageMB} MB (${stats.memory.percent}%)`);
      console.log(`CPU usage: ${stats.cpu.percent}%`);
    });
  });
});
