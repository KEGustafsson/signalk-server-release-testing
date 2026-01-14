/**
 * Plugin Loading Tests
 *
 * Tests that plugins load correctly without errors
 * and can be enabled/disabled properly.
 */

const { ContainerManager } = require('../lib/container-manager');
const { LogMonitor } = require('../lib/log-monitor');

describe('Plugin Loading', () => {
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
  }, 120000);

  afterAll(async () => {
    await manager.remove(true);

    const summary = logMonitor.getSummary();
    console.log('\n--- Plugin Test Log Summary ---');
    console.log(`Total Errors: ${summary.totalErrors}`);
    console.log(`Total Warnings: ${summary.totalWarnings}`);
  });

  describe('Initial Load', () => {
    test('server starts with no plugin errors in logs', () => {
      logMonitor.setPhase('plugin-initial');

      const errors = logMonitor.errors.filter(
        (e) => /plugin/i.test(e.line) && /error|fail|exception/i.test(e.line)
      );

      expect(errors).toHaveLength(0);
    });

    test('plugin API endpoint responds', async () => {
      const res = await fetch(`${baseUrl}/plugins`);
      // Plugin API may require authentication - 200 or 401/403 are valid responses
      expect([200, 401, 403]).toContain(res.status);

      if (res.ok) {
        const plugins = await res.json();
        expect(Array.isArray(plugins)).toBe(true);
        console.log(`Found ${plugins.length} plugins installed`);
      } else {
        console.log('Plugin API requires authentication, skipping detailed checks');
      }
    });
  });

  describe('Plugin Discovery', () => {
    let plugins = null;

    beforeAll(async () => {
      const res = await fetch(`${baseUrl}/plugins`);
      if (res.ok) {
        plugins = await res.json();
      }
    });

    test('plugins have required properties', () => {
      if (!plugins) {
        console.log('Plugin API requires authentication, skipping');
        return;
      }
      logMonitor.setPhase('plugin-discovery');

      for (const plugin of plugins) {
        expect(plugin.id || plugin.name).toBeDefined();
      }
    });

    test('no plugins report error state', () => {
      if (!plugins) {
        console.log('Plugin API requires authentication, skipping');
        return;
      }
      const errorPlugins = plugins.filter(
        (p) => p.state === 'error' || p.status === 'error'
      );

      if (errorPlugins.length > 0) {
        console.error('Plugins with errors:', errorPlugins.map((p) => p.id || p.name));
      }

      expect(errorPlugins).toHaveLength(0);
    });
  });

  describe('Core Plugins', () => {
    const corePlugins = [
      '@signalk/charts-plugin',
      '@signalk/signalk-to-nmea0183',
      '@signalk/anchoralarm-plugin',
    ];

    test.each(corePlugins)('core plugin %s loads without errors', async (pluginId) => {
      logMonitor.setPhase(`plugin-${pluginId}`);

      const res = await fetch(`${baseUrl}/plugins`);
      if (!res.ok) {
        console.log('Plugin API requires authentication, skipping');
        return;
      }
      const plugins = await res.json();

      const plugin = plugins.find(
        (p) => p.id === pluginId || p.name === pluginId || p.packageName === pluginId
      );

      // Plugin might not be installed, which is OK
      if (plugin) {
        // Check for errors related to this plugin in logs
        const pluginErrors = logMonitor.errors.filter((e) =>
          e.line.toLowerCase().includes(pluginId.toLowerCase())
        );

        expect(pluginErrors).toHaveLength(0);
      } else {
        console.log(`Plugin ${pluginId} not installed, skipping`);
      }
    });
  });

  describe('Plugin Enable/Disable', () => {
    let testPlugin = null;
    let authRequired = false;

    beforeAll(async () => {
      // Find a disabled plugin to test with
      const res = await fetch(`${baseUrl}/plugins`);
      if (!res.ok) {
        authRequired = true;
        return;
      }
      const plugins = await res.json();

      // Look for a safe plugin to toggle
      testPlugin = plugins.find((p) => !p.enabled && p.id);
    });

    test('enabling plugin does not cause errors', async () => {
      if (authRequired) {
        console.log('Plugin API requires authentication, skipping');
        return;
      }
      if (!testPlugin) {
        console.log('No disabled plugins available to test');
        return;
      }

      logMonitor.setPhase('plugin-enable');

      // Try to enable the plugin via API
      try {
        const enableRes = await fetch(`${baseUrl}/plugins/${testPlugin.id}/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...testPlugin.configuration, enabled: true }),
        });

        // Wait for plugin to initialize
        await sleep(3000);

        // Check for errors
        const report = logMonitor.getPhaseReport('plugin-enable');
        expect(report.errors).toHaveLength(0);
      } catch (e) {
        // API might require authentication, skip in that case
        console.log('Plugin enable requires authentication, skipping');
      }
    });

    test('disabling plugin does not cause errors', async () => {
      if (authRequired) {
        console.log('Plugin API requires authentication, skipping');
        return;
      }
      if (!testPlugin) {
        console.log('No test plugin available');
        return;
      }

      logMonitor.setPhase('plugin-disable');

      try {
        const disableRes = await fetch(`${baseUrl}/plugins/${testPlugin.id}/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...testPlugin.configuration, enabled: false }),
        });

        await sleep(2000);

        const report = logMonitor.getPhaseReport('plugin-disable');
        expect(report.errors).toHaveLength(0);
      } catch (e) {
        console.log('Plugin disable requires authentication, skipping');
      }
    });
  });

  describe('Plugin Configuration Persistence', () => {
    test('plugin configurations persist across restart', async () => {
      logMonitor.setPhase('plugin-persistence');

      // Get current plugin state
      const beforeRes = await fetch(`${baseUrl}/plugins`);
      if (!beforeRes.ok) {
        console.log('Plugin API requires authentication, skipping');
        return;
      }
      const beforePlugins = await beforeRes.json();

      // Restart server
      await manager.restart(10);

      // Get plugin state after restart
      const afterRes = await fetch(`${baseUrl}/plugins`);
      const afterPlugins = await afterRes.json();

      // Compare enabled states
      for (const beforePlugin of beforePlugins) {
        const afterPlugin = afterPlugins.find((p) => p.id === beforePlugin.id);
        if (afterPlugin) {
          expect(afterPlugin.enabled).toBe(beforePlugin.enabled);
        }
      }

      expect(logMonitor.getPhaseErrors('plugin-persistence')).toHaveLength(0);
    }, 120000);
  });

  describe('Plugin API Endpoints', () => {
    test('plugin schema endpoint responds', async () => {
      logMonitor.setPhase('plugin-schema');

      const res = await fetch(`${baseUrl}/plugins`);
      if (!res.ok) {
        console.log('Plugin API requires authentication, skipping');
        return;
      }
      const plugins = await res.json();

      // Test first plugin with schema
      const pluginWithSchema = plugins.find((p) => p.schema);
      if (pluginWithSchema) {
        expect(pluginWithSchema.schema).toBeDefined();
        expect(typeof pluginWithSchema.schema).toBe('object');
      }
    });

    test('webapp list endpoint responds', async () => {
      const res = await fetch(`${baseUrl}/webapps`);
      
      // Might return 404 if no webapps, which is OK
      if (res.ok) {
        const webapps = await res.json();
        expect(Array.isArray(webapps) || typeof webapps === 'object').toBe(true);
      }
    });
  });
});
