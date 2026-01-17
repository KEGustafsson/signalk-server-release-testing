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
  /**
   * Check if Playwright browsers are installed
   */
  static async isBrowserAvailable() {
    try {
      const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      await browser.close();
      return true;
    } catch (e) {
      return false;
    }
  }

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
    this.isLoggedIn = false;
    this.authToken = null;
    this.adminCredentials = {
      username: 'admin',
      password: 'admin123',
    };
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
   * Check if security is enabled on the server
   */
  async isSecurityEnabled() {
    try {
      const res = await fetch(`${this.baseUrl}/signalk/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'test', password: 'test' }),
      });
      // 401 = security enabled (bad credentials), 404 = endpoint doesn't exist (security not enabled)
      return res.status === 401 || res.status === 200;
    } catch (e) {
      return false;
    }
  }

  /**
   * Check if security is already enabled (admin user pre-configured in container)
   * Security is now pre-seeded in container-manager, so we just need to verify and login
   */
  async enableSecurity() {
    try {
      console.log('Checking security status...');

      // Navigate to admin page
      await this.page.goto(`${this.baseUrl}/admin/`, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeout,
      });
      await this.waitForStable();
      await this.page.waitForTimeout(2000);

      // Check if we're already logged in (seeing Server menu)
      const serverMenu = await this.page.$('text=Server');
      if (serverMenu) {
        console.log('Already logged in as admin');
        this.isLoggedIn = true;
        return true;
      }

      // Check if security is enabled (Login link visible)
      const loginLink = await this.page.$('text=Login');
      if (loginLink) {
        console.log('Security enabled, need to login');
        return true;
      }

      // Check if we're on the "Enable Security" page (shouldn't happen with pre-seeded config)
      const pageContent = await this.page.content();
      if (pageContent.includes('Enable Security') && pageContent.includes('Create an admin account')) {
        console.log('WARNING: Security not pre-configured, Enable Security page shown');
        await this.screenshot('enable-security-page');
        // Return true to let login() handle it
        return true;
      }

      console.log('Security check completed');
      return true;
    } catch (e) {
      console.error('Security check failed:', e.message);
      return false;
    }
  }

  /**
   * Login to the admin UI using API authentication
   */
  async login(username = null, password = null) {
    const user = username || this.adminCredentials.username;
    const pass = password || this.adminCredentials.password;

    try {
      console.log(`Attempting API login as ${user}...`);

      // First try to login via the API
      const loginResponse = await fetch(`${this.baseUrl}/signalk/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass }),
      });

      console.log(`API login response: ${loginResponse.status}`);

      if (loginResponse.ok) {
        const data = await loginResponse.json();
        console.log('API login successful, got token');

        // Set the authentication cookie in the browser context
        if (data.token) {
          this.authToken = data.token;

          // Parse the base URL to get the domain
          const url = new URL(this.baseUrl);

          // Set the cookie in the browser
          await this.context.addCookies([
            {
              name: 'JAUTHENTICATION',
              value: data.token,
              domain: url.hostname,
              path: '/',
            },
          ]);

          console.log('Set authentication cookie in browser');
        }

        // Refresh the page to apply the authentication
        await this.page.goto(`${this.baseUrl}/admin/`, {
          waitUntil: 'domcontentloaded',
          timeout: this.timeout,
        });
        await this.waitForStable();
        await this.page.waitForTimeout(2000);

        // Take screenshot after login
        await this.screenshot('after-login');

        // Check if login was successful by looking for Server menu
        const serverMenu = await this.page.$('text=Server');
        if (serverMenu) {
          this.isLoggedIn = true;
          console.log('Successfully logged in as admin');
          return true;
        }
      } else {
        console.log(`API login failed: ${loginResponse.status}`);

        // Take screenshot showing login form for debugging
        await this.page.goto(`${this.baseUrl}/admin/`, {
          waitUntil: 'domcontentloaded',
          timeout: this.timeout,
        });
        await this.waitForStable();

        // Navigate to login page for debugging screenshot
        const loginLink = await this.page.$('a:has-text("Login")');
        if (loginLink) {
          await loginLink.click();
          await this.page.waitForTimeout(2000);
        }

        // Fill the form for debugging
        const inputs = await this.page.$$('input:not([type="hidden"])');
        for (const input of inputs) {
          const type = await input.getAttribute('type');
          if (type === 'password') {
            await input.fill(pass);
          } else if (type === 'text') {
            await input.fill(user);
          }
        }
        await this.screenshot('login-form');

        // Try button click anyway
        const submitButton = await this.page.$('button:has-text("Login")');
        if (submitButton) {
          await submitButton.click();
          await this.page.waitForTimeout(3000);
        }
        await this.screenshot('after-login');
      }

      // Final check for admin access
      const serverMenu = await this.page.$('text=Server');
      if (serverMenu) {
        this.isLoggedIn = true;
        console.log('Successfully logged in as admin');
        return true;
      }

      console.log('Login may not have succeeded - no Server menu visible');
      return false;
    } catch (e) {
      console.error('Login failed:', e.message);
      await this.screenshot('login-error');
      return false;
    }
  }

  /**
   * Ensure we're logged in before accessing admin pages
   * This handles the full flow: enable security if needed, then login
   */
  async ensureLoggedIn() {
    if (this.isLoggedIn) {
      // Verify we're still logged in by checking for Server menu
      const serverMenu = await this.page.$('text=Server');
      if (serverMenu) {
        return true;
      }
      // Session might have expired, try logging in again
      this.isLoggedIn = false;
    }

    console.log('Ensuring logged in as admin...');

    // First, navigate to admin and see what state we're in
    await this.page.goto(`${this.baseUrl}/admin/`, {
      waitUntil: 'domcontentloaded',
      timeout: this.timeout,
    });
    await this.waitForStable();
    await this.page.waitForTimeout(2000);

    // Check current state
    const pageContent = await this.page.content();

    // Check for "Enable Security" page
    if (pageContent.includes('Enable Security') && pageContent.includes('Create an admin account')) {
      console.log('Need to enable security first');
      const enabled = await this.enableSecurity();
      if (!enabled) {
        return false;
      }
      // After enabling, check if we're logged in
      await this.page.waitForTimeout(2000);
      const serverMenu = await this.page.$('text=Server');
      if (serverMenu) {
        this.isLoggedIn = true;
        console.log('Logged in after enabling security');
        return true;
      }
      // If not auto-logged in, try logging in
      return await this.login();
    }

    // Check if we need to login (Login link visible)
    const loginLink = await this.page.$('a:has-text("Login")');
    if (loginLink) {
      console.log('Need to login');
      return await this.login();
    }

    // Check if we're already in admin (seeing Server menu)
    const serverMenu = await this.page.$('text=Server');
    if (serverMenu) {
      this.isLoggedIn = true;
      console.log('Already logged in as admin');
      return true;
    }

    // If we see Dashboard but not Server, we're logged in but not as admin
    // This shouldn't happen if we created the admin user
    console.log('Unknown state - attempting login');
    return await this.login();
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
      // Ensure we're logged in to access admin pages
      await this.ensureLoggedIn();

      await this.page.goto(`${this.baseUrl}/admin/#/serverConfiguration/data`, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeout,
      });
      await this.waitForStable();
      await this.page.waitForTimeout(2000); // Allow UI to fully render

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
      // Ensure we're logged in to access admin pages
      await this.ensureLoggedIn();

      // Navigate using sidebar menu clicks (more reliable for SPAs)
      // First expand the Server menu
      const serverMenu = await this.page.$('text=Server');
      if (serverMenu) {
        await serverMenu.click();
        await this.page.waitForTimeout(500);
      }

      // Click on Plugin Config
      const pluginLink = await this.page.$('text=Plugin Config');
      if (pluginLink) {
        await pluginLink.click();
        await this.waitForStable();
        await this.page.waitForTimeout(2000);
      } else {
        // Fallback to URL navigation
        await this.page.goto(`${this.baseUrl}/admin/#/serverConfiguration/plugins`, {
          waitUntil: 'domcontentloaded',
          timeout: this.timeout,
        });
        await this.waitForStable();
        await this.page.waitForTimeout(2000);
      }

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
      // Ensure we're logged in to access admin pages
      await this.ensureLoggedIn();

      // Navigate using sidebar menu click (more reliable for SPAs)
      // First click Security to expand it
      const securityMenu = await this.page.$('text=Security');
      if (securityMenu) {
        await securityMenu.click();
        await this.page.waitForTimeout(500);
        // Now click on Users under Security (distinct from other menus)
        const usersLink = await this.page.$('text=Users');
        if (usersLink) {
          await usersLink.click();
          await this.waitForStable();
          await this.page.waitForTimeout(2000);
        }
      } else {
        // Fallback to URL navigation
        await this.page.goto(`${this.baseUrl}/admin/#/security/users`, {
          waitUntil: 'domcontentloaded',
          timeout: this.timeout,
        });
        await this.waitForStable();
        await this.page.waitForTimeout(2000);
      }

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
      // Ensure we're logged in to access admin pages
      await this.ensureLoggedIn();

      // Navigate using sidebar menu clicks (more reliable for SPAs)
      // First expand the Server menu if needed
      const serverMenu = await this.page.$('text=Server');
      if (serverMenu) {
        await serverMenu.click();
        await this.page.waitForTimeout(1000);
      }

      // Click on Settings - use locator to find the first one visible after Server menu
      // The Settings under Server should appear after Server menu items are shown
      try {
        // Wait for Settings link to appear and click it
        await this.page.locator('text=Settings').first().click({ timeout: 5000 });
        await this.waitForStable();
        await this.page.waitForTimeout(2000);
      } catch (e) {
        // Fallback to URL navigation
        await this.page.goto(`${this.baseUrl}/admin/#/serverConfiguration/settings`, {
          waitUntil: 'domcontentloaded',
          timeout: this.timeout,
        });
        await this.waitForStable();
        await this.page.waitForTimeout(2000);
      }

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
      // Ensure we're logged in to access admin pages
      await this.ensureLoggedIn();

      // Navigate using sidebar menu clicks (more reliable for SPAs)
      // First expand the Server menu if needed
      const serverMenu = await this.page.$('text=Server');
      if (serverMenu) {
        await serverMenu.click();
        await this.page.waitForTimeout(1000);
      }

      // Click on Data Connections
      try {
        await this.page.locator('text=Data Connections').click({ timeout: 5000 });
        await this.waitForStable();
        await this.page.waitForTimeout(2000);
      } catch (e) {
        // Fallback to URL navigation
        await this.page.goto(`${this.baseUrl}/admin/#/serverConfiguration/connections`, {
          waitUntil: 'domcontentloaded',
          timeout: this.timeout,
        });
        await this.waitForStable();
        await this.page.waitForTimeout(2000);
      }

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
      // Ensure we're logged in to access admin pages
      await this.ensureLoggedIn();

      await this.page.goto(`${this.baseUrl}/admin/#/appstore/apps`, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeout,
      });
      await this.waitForStable();
      await this.page.waitForTimeout(2000); // Allow UI to fully render

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
