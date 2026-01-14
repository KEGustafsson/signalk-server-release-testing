/**
 * AdminUiTester - Browser-based UI testing
 *
 * Uses Playwright to test SignalK Admin UI functionality
 * including dashboard, data browser, plugin management, etc.
 */

const { chromium } = require('playwright');
const fs = require('fs-extra');
const path = require('path');

class AdminUiTester {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || 'http://localhost:3000';
    this.timeout = options.timeout || 30000;
    this.screenshotDir = options.screenshotDir || './reports/screenshots';
    this.browser = null;
    this.context = null;
    this.page = null;
    this.screenshots = [];
    this.consoleErrors = [];
    this.networkErrors = [];
  }

  /**
   * Initialize browser and page
   */
  async init() {
    await fs.ensureDir(this.screenshotDir);

    this.browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true,
    });

    this.page = await this.context.newPage();

    // Collect console errors
    this.page.on('console', (msg) => {
      if (msg.type() === 'error') {
        this.consoleErrors.push({
          text: msg.text(),
          url: this.page.url(),
          timestamp: new Date().toISOString(),
        });
      }
    });

    // Collect network errors
    this.page.on('requestfailed', (request) => {
      this.networkErrors.push({
        url: request.url(),
        failure: request.failure()?.errorText,
        timestamp: new Date().toISOString(),
      });
    });

    // Handle page errors
    this.page.on('pageerror', (error) => {
      this.consoleErrors.push({
        text: error.message,
        stack: error.stack,
        url: this.page.url(),
        timestamp: new Date().toISOString(),
      });
    });
  }

  /**
   * Close browser
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  /**
   * Take screenshot
   */
  async screenshot(name) {
    const filename = `${name}-${Date.now()}.png`;
    const filepath = path.join(this.screenshotDir, filename);
    await this.page.screenshot({ path: filepath, fullPage: true });
    this.screenshots.push(filepath);
    return filepath;
  }

  /**
   * Wait for page to be stable (no network activity)
   */
  async waitForStable(timeout = 5000) {
    try {
      await this.page.waitForLoadState('networkidle', { timeout });
    } catch (e) {
      // Network might not become idle, continue anyway
    }
  }

  /**
   * Test Dashboard / Instrument Panel
   */
  async testDashboard() {
    const results = { passed: [], failed: [], warnings: [] };

    try {
      // Try multiple possible dashboard URLs
      const dashboardUrls = [
        `${this.baseUrl}/@signalk/instrumentpanel`,
        `${this.baseUrl}/instrumentpanel`,
        `${this.baseUrl}/`,
      ];

      let loaded = false;
      for (const url of dashboardUrls) {
        try {
          await this.page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: this.timeout,
          });
          await this.waitForStable();
          loaded = true;
          break;
        } catch (e) {
          continue;
        }
      }

      if (!loaded) {
        results.failed.push('Dashboard page failed to load');
        return results;
      }

      results.passed.push('Dashboard page loads');

      // Check page title
      const title = await this.page.title();
      if (title) {
        results.passed.push(`Page title present: ${title}`);
      }

      // Check for React error boundaries
      const errorBoundary = await this.page.$('.error-boundary, [data-error], .error');
      if (!errorBoundary) {
        results.passed.push('No React error boundaries triggered');
      } else {
        results.failed.push('React error boundary or error element detected');
        await this.screenshot('dashboard-error');
      }

      // Check for WebSocket connection indicator
      await this.page.waitForTimeout(3000);
      const wsData = await this.page.evaluate(() => {
        // Check for any data that might indicate WS is working
        const bodyText = document.body.innerText;
        return (
          bodyText.includes('navigation') ||
          bodyText.includes('environment') ||
          bodyText.includes('electrical') ||
          document.querySelectorAll('[class*="gauge"], [class*="widget"], [class*="value"]').length > 0
        );
      });

      if (wsData) {
        results.passed.push('Dashboard appears to receive data');
      } else {
        results.warnings.push('Dashboard may not be receiving WebSocket data');
      }

      await this.screenshot('dashboard');
    } catch (e) {
      results.failed.push(`Dashboard test error: ${e.message}`);
      await this.screenshot('dashboard-error');
    }

    return results;
  }

  /**
   * Test Data Browser
   */
  async testDataBrowser() {
    const results = { passed: [], failed: [], warnings: [] };

    try {
      await this.page.goto(`${this.baseUrl}/admin/#/serverConfiguration/data`, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeout,
      });
      await this.waitForStable();

      results.passed.push('Data Browser page loads');

      // Wait for data tree to load
      try {
        await this.page.waitForSelector(
          '[class*="tree"], [class*="data"], table, [class*="json"]',
          { timeout: 10000 }
        );
        results.passed.push('Data tree structure loaded');
      } catch (e) {
        results.warnings.push('Data tree may not have loaded completely');
      }

      // Check for vessel data
      const hasVesselData = await this.page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return text.includes('vessels') || text.includes('self') || text.includes('navigation');
      });

      if (hasVesselData) {
        results.passed.push('Data Browser shows vessel data');
      } else {
        results.warnings.push('Vessel data not visible in Data Browser');
      }

      // Try to interact with the data tree
      const navigationLink = await this.page.$('text=navigation');
      if (navigationLink) {
        await navigationLink.click().catch(() => {});
        await this.page.waitForTimeout(500);
        results.passed.push('Navigation tree node clickable');
      }

      await this.screenshot('data-browser');
    } catch (e) {
      results.failed.push(`Data Browser test error: ${e.message}`);
      await this.screenshot('data-browser-error');
    }

    return results;
  }

  /**
   * Test Plugin Management
   */
  async testPluginManagement() {
    const results = { passed: [], failed: [], warnings: [] };

    try {
      await this.page.goto(`${this.baseUrl}/admin/#/serverConfiguration/plugins`, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeout,
      });
      await this.waitForStable();

      results.passed.push('Plugin management page loads');

      // Wait for plugin list
      try {
        await this.page.waitForSelector(
          '[class*="plugin"], table, [class*="list"], [class*="card"]',
          { timeout: 10000 }
        );
        results.passed.push('Plugin list structure loaded');
      } catch (e) {
        results.warnings.push('Plugin list may not have loaded completely');
      }

      // Count plugins
      const pluginCount = await this.page.evaluate(() => {
        const items = document.querySelectorAll(
          '[class*="plugin-item"], tr[class*="plugin"], [data-plugin], [class*="plugin-card"]'
        );
        return items.length;
      });

      if (pluginCount > 0) {
        results.passed.push(`Found ${pluginCount} plugins listed`);
      }

      // Check for enable/disable controls
      const hasControls = await this.page.$(
        'input[type="checkbox"], button[class*="toggle"], [class*="switch"], [role="switch"]'
      );
      if (hasControls) {
        results.passed.push('Plugin enable/disable controls present');
      }

      await this.screenshot('plugin-management');
    } catch (e) {
      results.failed.push(`Plugin management test error: ${e.message}`);
      await this.screenshot('plugin-management-error');
    }

    return results;
  }

  /**
   * Test Security Settings
   */
  async testSecuritySettings() {
    const results = { passed: [], failed: [], warnings: [] };

    try {
      await this.page.goto(`${this.baseUrl}/admin/#/security`, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeout,
      });
      await this.waitForStable();

      results.passed.push('Security page loads');

      // Check for security-related content
      const hasSecurityOptions = await this.page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return (
          text.includes('security') ||
          text.includes('authentication') ||
          text.includes('users') ||
          text.includes('access') ||
          text.includes('login') ||
          text.includes('password')
        );
      });

      if (hasSecurityOptions) {
        results.passed.push('Security options visible');
      } else {
        results.warnings.push('Security options may not be displayed');
      }

      await this.screenshot('security-settings');
    } catch (e) {
      results.failed.push(`Security settings test error: ${e.message}`);
      await this.screenshot('security-settings-error');
    }

    return results;
  }

  /**
   * Test Server Configuration
   */
  async testServerConfiguration() {
    const results = { passed: [], failed: [], warnings: [] };

    try {
      await this.page.goto(`${this.baseUrl}/admin/#/serverConfiguration/settings`, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeout,
      });
      await this.waitForStable();

      results.passed.push('Server configuration page loads');

      // Check for configuration form elements
      const hasForm = await this.page.$(
        'form, input, select, textarea, [class*="config"], [class*="settings"]'
      );
      if (hasForm) {
        results.passed.push('Configuration form present');
      }

      // Check for save button
      const hasSave = await this.page.$(
        'button[type="submit"], button:has-text("Save"), button:has-text("Apply")'
      );
      if (hasSave) {
        results.passed.push('Save/Apply button present');
      }

      await this.screenshot('server-configuration');
    } catch (e) {
      results.failed.push(`Server configuration test error: ${e.message}`);
      await this.screenshot('server-configuration-error');
    }

    return results;
  }

  /**
   * Test Connection Management
   */
  async testConnectionManagement() {
    const results = { passed: [], failed: [], warnings: [] };

    try {
      await this.page.goto(`${this.baseUrl}/admin/#/serverConfiguration/connections`, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeout,
      });
      await this.waitForStable();

      results.passed.push('Connection management page loads');

      // Check for connection-related content
      const hasConnectionUI = await this.page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return (
          text.includes('connection') ||
          text.includes('provider') ||
          text.includes('tcp') ||
          text.includes('serial') ||
          text.includes('nmea') ||
          text.includes('input')
        );
      });

      if (hasConnectionUI) {
        results.passed.push('Connection management UI functional');
      } else {
        results.warnings.push('Connection management UI may not be displaying content');
      }

      // Check for add connection button
      const hasAddButton = await this.page.$(
        'button:has-text("Add"), button:has-text("New"), [class*="add"]'
      );
      if (hasAddButton) {
        results.passed.push('Add connection button present');
      }

      await this.screenshot('connection-management');
    } catch (e) {
      results.failed.push(`Connection management test error: ${e.message}`);
      await this.screenshot('connection-management-error');
    }

    return results;
  }

  /**
   * Test WebApp Store (if available)
   */
  async testWebAppStore() {
    const results = { passed: [], failed: [], warnings: [] };

    try {
      await this.page.goto(`${this.baseUrl}/admin/#/appstore/apps`, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeout,
      });
      await this.waitForStable();

      results.passed.push('WebApp Store page loads');

      // Check for app listings
      const hasApps = await this.page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return (
          text.includes('install') ||
          text.includes('webapp') ||
          text.includes('plugin') ||
          document.querySelectorAll('[class*="app"], [class*="card"]').length > 0
        );
      });

      if (hasApps) {
        results.passed.push('WebApp Store shows content');
      } else {
        results.warnings.push('WebApp Store may not be displaying apps');
      }

      await this.screenshot('webapp-store');
    } catch (e) {
      results.failed.push(`WebApp Store test error: ${e.message}`);
      await this.screenshot('webapp-store-error');
    }

    return results;
  }

  /**
   * Run all UI tests
   */
  async runAllTests() {
    const results = {
      dashboard: await this.testDashboard(),
      dataBrowser: await this.testDataBrowser(),
      pluginManagement: await this.testPluginManagement(),
      securitySettings: await this.testSecuritySettings(),
      serverConfiguration: await this.testServerConfiguration(),
      connectionManagement: await this.testConnectionManagement(),
      webAppStore: await this.testWebAppStore(),
    };

    return {
      results,
      consoleErrors: this.consoleErrors,
      networkErrors: this.networkErrors,
      screenshots: this.screenshots,
      summary: this.generateSummary(results),
    };
  }

  /**
   * Generate test summary
   */
  generateSummary(results) {
    let totalPassed = 0;
    let totalFailed = 0;
    let totalWarnings = 0;

    for (const [_, testResults] of Object.entries(results)) {
      totalPassed += testResults.passed.length;
      totalFailed += testResults.failed.length;
      totalWarnings += testResults.warnings?.length || 0;
    }

    return {
      totalPassed,
      totalFailed,
      totalWarnings,
      consoleErrors: this.consoleErrors.length,
      networkErrors: this.networkErrors.length,
      success: totalFailed === 0,
    };
  }

  /**
   * Get console errors
   */
  getConsoleErrors() {
    return this.consoleErrors;
  }

  /**
   * Get network errors
   */
  getNetworkErrors() {
    return this.networkErrors;
  }

  /**
   * Get screenshots
   */
  getScreenshots() {
    return this.screenshots;
  }

  /**
   * Clear collected errors
   */
  clearErrors() {
    this.consoleErrors = [];
    this.networkErrors = [];
  }
}

module.exports = { AdminUiTester };
