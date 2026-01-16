/**
 * CustomReporter - Jest reporter for validation reports
 *
 * Provides clean console output during test runs and generates
 * detailed reports in multiple formats.
 */

const fs = require('fs-extra');
const path = require('path');

class CustomReporter {
  constructor(globalConfig, options) {
    this._globalConfig = globalConfig;
    this._options = options || {};
    this.outputDir = options.outputDir || './reports';
    this.results = {
      startTime: null,
      endTime: null,
      image: process.env.SIGNALK_IMAGE || 'signalk/signalk-server:latest',
      tests: [],
      summary: {},
    };
    this.currentFile = null;
    this.fileStartTime = null;
  }

  log(message) {
    process.stdout.write(message);
  }

  onRunStart(results, options) {
    this.results.startTime = new Date().toISOString();
    fs.ensureDirSync(this.outputDir);
    fs.ensureDirSync(path.join(this.outputDir, 'screenshots'));
    fs.ensureDirSync(path.join(this.outputDir, 'logs'));

    this.log('\n');
    this.log('╔══════════════════════════════════════════════════════════════╗\n');
    this.log('║        SignalK Server Release Validation Suite              ║\n');
    this.log('╚══════════════════════════════════════════════════════════════╝\n');
    this.log(`  Image: ${this.results.image}\n`);
    this.log(`  Date:  ${new Date().toISOString().split('T')[0]}\n`);
    this.log('\n');
  }

  onTestFileStart(test) {
    this.currentFile = path.basename(test.path);
    this.fileStartTime = Date.now();
    const category = this.getTestCategory(this.currentFile);
    this.log(`  ▶ ${category}...`);
  }

  getTestCategory(filename) {
    const categories = {
      '01-server-lifecycle': 'Server Lifecycle',
      '02-plugin-loading': 'Plugin Loading',
      '03-nmea0183': 'NMEA 0183 Input',
      '05-nmea2000-input': 'NMEA 2000 Input',
      '06-realworld-scenarios': 'Real-World Scenarios',
      '07-admin-dashboard': 'Admin Dashboard',
      '08-admin-databrowser': 'Admin Data Browser',
      '09-admin-plugins': 'Admin Plugins',
      '10-admin-security': 'Admin Security',
      '11-stress-test': 'Stress Tests',
      '12-rest-api': 'REST API',
      '13-websocket-streaming': 'WebSocket Streaming',
      '14-delta-put': 'Delta PUT Operations',
      '15-data-conversion': 'Data Conversion',
      '16-authentication': 'Authentication & Security',
      '17-nmea-output': 'NMEA Output Validation',
      '18-end-to-end-flow': 'End-to-End Data Flow',
      '19-sustained-load': 'Sustained Load',
      'core-api': 'Core API (Combined)',
    };

    for (const [key, value] of Object.entries(categories)) {
      if (filename.includes(key)) {
        return value;
      }
    }
    return filename.replace('.test.js', '');
  }

  getCategoryDescription(filename) {
    const descriptions = {
      '01-server-lifecycle': 'Tests server start, stop, restart, and crash recovery',
      '02-plugin-loading': 'Tests plugin discovery, loading, and configuration',
      '03-nmea0183': 'Tests NMEA 0183 TCP and UDP data input processing',
      '05-nmea2000-input': 'Tests NMEA 2000 data input processing',
      '06-realworld-scenarios': 'Tests real-world navigation scenarios',
      '07-admin-dashboard': 'Tests Admin UI dashboard functionality',
      '08-admin-databrowser': 'Tests Admin UI data browser',
      '09-admin-plugins': 'Tests Admin UI plugin management',
      '10-admin-security': 'Tests Admin UI security settings',
      '11-stress-test': 'Tests server behavior under heavy load',
      '12-rest-api': 'Tests REST API endpoints and responses',
      '13-websocket-streaming': 'Tests WebSocket data streaming',
      '14-delta-put': 'Tests delta PUT operations',
      '15-data-conversion': 'Tests unit conversions (knots to m/s, etc.)',
      '16-authentication': 'Tests authentication, authorization, and security',
      '17-nmea-output': 'Tests NMEA 0183 output generation',
      '18-end-to-end-flow': 'Tests complete data flow from input to all outputs',
      '19-sustained-load': 'Tests server stability under sustained load',
      'core-api': 'Combined core API tests for efficiency',
    };

    for (const [key, value] of Object.entries(descriptions)) {
      if (filename.includes(key)) {
        return value;
      }
    }
    return '';
  }

  onTestFileResult(test, testResult, results) {
    const duration = ((Date.now() - this.fileStartTime) / 1000).toFixed(1);
    const passed = testResult.numPassingTests;
    const failed = testResult.numFailingTests;
    const total = passed + failed;

    if (failed > 0) {
      this.log(` FAIL (${passed}/${total} passed, ${duration}s)\n`);
      for (const result of testResult.testResults) {
        if (result.status === 'failed') {
          this.log(`      ✗ ${result.title}\n`);
          if (result.failureMessages.length > 0) {
            const errorLine = result.failureMessages[0].split('\n')[0].substring(0, 70);
            this.log(`        ${errorLine}\n`);
          }
        }
      }
    } else {
      this.log(` OK (${total} tests, ${duration}s)\n`);
    }

    const testInfo = {
      file: path.basename(testResult.testFilePath),
      category: this.getTestCategory(path.basename(testResult.testFilePath)),
      description: this.getCategoryDescription(path.basename(testResult.testFilePath)),
      duration: testResult.perfStats.end - testResult.perfStats.start,
      status: testResult.numFailingTests > 0 ? 'failed' : 'passed',
      tests: testResult.testResults.map((t) => ({
        name: t.title,
        fullName: t.fullName,
        status: t.status,
        duration: t.duration,
        failureMessages: t.failureMessages,
      })),
    };

    this.results.tests.push(testInfo);
  }

  onTestResult(test, testResult, results) {
    // This is called after onTestFileResult, we use that instead
  }

  onRunComplete(contexts, results) {
    this.results.endTime = new Date().toISOString();
    this.results.summary = {
      total: results.numTotalTests,
      passed: results.numPassedTests,
      failed: results.numFailedTests,
      skipped: results.numPendingTests,
      duration: results.testResults.reduce(
        (acc, t) => acc + (t.perfStats.end - t.perfStats.start),
        0
      ),
      success: results.numFailedTests === 0,
    };

    const duration = (this.results.summary.duration / 1000).toFixed(1);
    const { passed, failed, total } = this.results.summary;

    this.log('\n');
    this.log('────────────────────────────────────────────────────────────────\n');
    this.log('  SUMMARY\n');
    this.log('────────────────────────────────────────────────────────────────\n');
    this.log(`  Total:    ${total} tests\n`);
    this.log(`  Passed:   ${passed}\n`);
    this.log(`  Failed:   ${failed}\n`);
    this.log(`  Duration: ${duration}s\n`);
    this.log('\n');

    if (failed === 0) {
      this.log('  ✓ ALL TESTS PASSED\n');
    } else {
      this.log(`  ✗ ${failed} TEST(S) FAILED\n`);
    }
    this.log('\n');

    this.generateJsonReport();
    this.generateMarkdownReport();
    this.generateHtmlReport();

    this.log(`  Reports saved to: ${this.outputDir}/\n`);
    this.log('\n');
  }

  generateJsonReport() {
    const reportPath = path.join(this.outputDir, 'results.json');
    fs.writeJsonSync(reportPath, this.results, { spaces: 2 });
  }

  generateMarkdownReport() {
    const summary = this.results.summary;
    const duration = (summary.duration / 1000).toFixed(1);

    let md = `# SignalK Server Release Validation Report\n\n`;

    // Environment
    md += `## Environment\n\n`;
    md += `| Property | Value |\n`;
    md += `|----------|-------|\n`;
    md += `| Image | \`${this.results.image}\` |\n`;
    md += `| Date | ${this.results.startTime} |\n`;
    md += `| Duration | ${duration}s |\n`;
    md += `| Node.js | ${process.version} |\n`;
    md += `| Platform | ${process.platform} |\n\n`;

    // Summary
    md += `## Summary\n\n`;
    md += `| Metric | Value |\n`;
    md += `|--------|-------|\n`;
    md += `| Total Tests | ${summary.total} |\n`;
    md += `| Passed | ${summary.passed} |\n`;
    md += `| Failed | ${summary.failed} |\n`;
    md += `| Skipped | ${summary.skipped} |\n`;
    md += `| **Status** | **${summary.success ? '✅ PASSED' : '❌ FAILED'}** |\n\n`;

    // Test Categories Overview
    md += `## Test Categories\n\n`;
    md += `| Status | Category | Description | Tests | Duration |\n`;
    md += `|--------|----------|-------------|-------|----------|\n`;

    for (const testFile of this.results.tests) {
      const passed = testFile.tests.filter((t) => t.status === 'passed').length;
      const failed = testFile.tests.filter((t) => t.status === 'failed').length;
      const status = failed > 0 ? '❌' : '✅';
      const dur = (testFile.duration / 1000).toFixed(1);
      md += `| ${status} | ${testFile.category} | ${testFile.description} | ${passed}/${testFile.tests.length} | ${dur}s |\n`;
    }
    md += '\n';

    // Detailed Test Results
    md += `## Detailed Test Results\n\n`;

    for (const testFile of this.results.tests) {
      const failed = testFile.tests.filter((t) => t.status === 'failed').length;
      const status = failed > 0 ? '❌' : '✅';

      md += `### ${status} ${testFile.category}\n\n`;
      md += `${testFile.description}\n\n`;
      md += `| Status | Test | Duration |\n`;
      md += `|--------|------|----------|\n`;

      for (const test of testFile.tests) {
        const testStatus = test.status === 'passed' ? '✅' : '❌';
        const testDur = test.duration ? `${test.duration}ms` : '-';
        md += `| ${testStatus} | ${test.name} | ${testDur} |\n`;
      }
      md += '\n';
    }

    // Failures section
    const failures = this.results.tests
      .flatMap((f) => f.tests)
      .filter((t) => t.status === 'failed');

    if (failures.length > 0) {
      md += `## ❌ Failures\n\n`;
      for (const failure of failures) {
        md += `### ${failure.fullName}\n\n`;
        md += '```\n';
        md += failure.failureMessages.join('\n').substring(0, 1000);
        md += '\n```\n\n';
      }
    }

    // Recommendation
    md += `## Recommendation\n\n`;
    if (summary.success) {
      md += `### ✅ APPROVED FOR RELEASE\n\n`;
      md += `All ${summary.total} tests passed. The image \`${this.results.image}\` is ready for release.\n`;
    } else {
      md += `### ❌ NOT APPROVED FOR RELEASE\n\n`;
      md += `${summary.failed} out of ${summary.total} tests failed. Please review the failures above before releasing.\n`;
    }

    const reportPath = path.join(this.outputDir, 'summary.md');
    fs.writeFileSync(reportPath, md);
  }

  generateHtmlReport() {
    const summary = this.results.summary;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SignalK Release Validation Report</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
    .container { max-width: 1100px; margin: 0 auto; }
    .card { background: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 20px; overflow: hidden; }
    .card-header { padding: 15px 20px; background: #f8f9fa; border-bottom: 1px solid #e9ecef; font-weight: 600; }
    .card-body { padding: 20px; }
    h1 { margin: 0 0 20px 0; color: #333; }
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; }
    .stat { text-align: center; padding: 15px; background: #f8f9fa; border-radius: 8px; }
    .stat-value { font-size: 32px; font-weight: bold; color: #333; }
    .stat-label { color: #666; font-size: 14px; margin-top: 5px; }
    .stat-value.passed { color: #22c55e; }
    .stat-value.failed { color: #ef4444; }
    .badge { display: inline-block; padding: 8px 20px; border-radius: 20px; font-weight: bold; font-size: 16px; }
    .badge-passed { background: #dcfce7; color: #166534; }
    .badge-failed { background: #fee2e2; color: #991b1b; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e9ecef; }
    th { background: #f8f9fa; font-weight: 600; }
    tr:hover { background: #f8f9fa; }
    .status-icon { font-size: 16px; }
    .category-row { cursor: pointer; }
    .category-row:hover { background: #f0f0f0; }
    .test-details { display: none; background: #fafafa; }
    .test-details.open { display: table-row; }
    .test-details td { padding: 0; }
    .test-list { margin: 0; padding: 10px 20px 10px 50px; }
    .test-list li { padding: 5px 0; color: #555; }
    .test-list li.passed::marker { content: "✅ "; }
    .test-list li.failed::marker { content: "❌ "; }
    .env-table td:first-child { font-weight: 500; width: 150px; }
    code { background: #e9ecef; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
    .failure { margin: 15px 0; padding: 15px; background: #fef2f2; border-left: 4px solid #ef4444; border-radius: 4px; }
    .failure h4 { margin: 0 0 10px 0; color: #991b1b; }
    pre { background: #1e1e1e; color: #d4d4d4; padding: 15px; border-radius: 8px; overflow-x: auto; font-size: 13px; margin: 10px 0 0 0; }
    .toggle-icon { float: right; transition: transform 0.2s; }
    .category-row.open .toggle-icon { transform: rotate(90deg); }
  </style>
</head>
<body>
  <div class="container">
    <h1>SignalK Server Release Validation Report</h1>

    <div class="card">
      <div class="card-header">Environment</div>
      <div class="card-body">
        <table class="env-table">
          <tr><td>Image</td><td><code>${this.results.image}</code></td></tr>
          <tr><td>Date</td><td>${this.results.startTime}</td></tr>
          <tr><td>Duration</td><td>${(summary.duration / 1000).toFixed(1)}s</td></tr>
          <tr><td>Node.js</td><td>${process.version}</td></tr>
          <tr><td>Platform</td><td>${process.platform}</td></tr>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-header">Summary</div>
      <div class="card-body">
        <div class="summary-grid">
          <div class="stat">
            <div class="stat-value">${summary.total}</div>
            <div class="stat-label">Total Tests</div>
          </div>
          <div class="stat">
            <div class="stat-value passed">${summary.passed}</div>
            <div class="stat-label">Passed</div>
          </div>
          <div class="stat">
            <div class="stat-value failed">${summary.failed}</div>
            <div class="stat-label">Failed</div>
          </div>
          <div class="stat">
            <div class="stat-value">${(summary.duration / 1000).toFixed(1)}s</div>
            <div class="stat-label">Duration</div>
          </div>
          <div class="stat">
            <span class="badge ${summary.success ? 'badge-passed' : 'badge-failed'}">
              ${summary.success ? '✅ PASSED' : '❌ FAILED'}
            </span>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">Test Results (click to expand)</div>
      <div class="card-body" style="padding: 0;">
        <table>
          <thead>
            <tr>
              <th style="width: 50px;">Status</th>
              <th>Category</th>
              <th>Description</th>
              <th style="width: 80px;">Tests</th>
              <th style="width: 80px;">Duration</th>
            </tr>
          </thead>
          <tbody>
            ${this.results.tests.map((t, idx) => {
              const passed = t.tests.filter((x) => x.status === 'passed').length;
              const failed = t.tests.filter((x) => x.status === 'failed').length;
              return `
                <tr class="category-row" onclick="toggleTests(${idx})">
                  <td class="status-icon">${failed > 0 ? '❌' : '✅'}</td>
                  <td><strong>${t.category}</strong> <span class="toggle-icon">▶</span></td>
                  <td>${t.description}</td>
                  <td>${passed}/${t.tests.length}</td>
                  <td>${(t.duration / 1000).toFixed(1)}s</td>
                </tr>
                <tr class="test-details" id="tests-${idx}">
                  <td colspan="5">
                    <ul class="test-list">
                      ${t.tests.map(test => `<li class="${test.status}">${test.name} <small style="color:#999">(${test.duration || 0}ms)</small></li>`).join('')}
                    </ul>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>

    ${summary.failed > 0 ? `
    <div class="card">
      <div class="card-header" style="background: #fef2f2; color: #991b1b;">❌ Failures</div>
      <div class="card-body">
        ${this.results.tests
          .flatMap((f) => f.tests)
          .filter((t) => t.status === 'failed')
          .map(t => `
            <div class="failure">
              <h4>${t.fullName}</h4>
              <pre>${t.failureMessages.join('\n').substring(0, 1000).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
            </div>
          `).join('')}
      </div>
    </div>
    ` : ''}

    <div class="card">
      <div class="card-header" style="background: ${summary.success ? '#dcfce7' : '#fee2e2'};">
        Recommendation
      </div>
      <div class="card-body">
        ${summary.success
          ? `<h3 style="color: #166534; margin: 0 0 10px 0;">✅ APPROVED FOR RELEASE</h3>
             <p style="margin: 0;">All ${summary.total} tests passed. The image <code>${this.results.image}</code> is ready for release.</p>`
          : `<h3 style="color: #991b1b; margin: 0 0 10px 0;">❌ NOT APPROVED FOR RELEASE</h3>
             <p style="margin: 0;">${summary.failed} out of ${summary.total} tests failed. Please review the failures above before releasing.</p>`
        }
      </div>
    </div>
  </div>

  <script>
    function toggleTests(idx) {
      const row = document.getElementById('tests-' + idx);
      const categoryRow = row.previousElementSibling;
      row.classList.toggle('open');
      categoryRow.classList.toggle('open');
    }
  </script>
</body>
</html>`;

    const reportPath = path.join(this.outputDir, 'report.html');
    fs.writeFileSync(reportPath, html);
  }
}

module.exports = CustomReporter;
