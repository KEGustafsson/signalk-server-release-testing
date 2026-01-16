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

    const image = process.env.SIGNALK_IMAGE || 'signalk/signalk-server:latest';
    this.log('\n');
    this.log('╔══════════════════════════════════════════════════════════════╗\n');
    this.log('║        SignalK Server Release Validation Suite              ║\n');
    this.log('╚══════════════════════════════════════════════════════════════╝\n');
    this.log(`  Image: ${image}\n`);
    this.log(`  Date:  ${new Date().toISOString().split('T')[0]}\n`);
    this.log('\n');
  }

  onTestFileStart(test) {
    this.currentFile = path.basename(test.path);
    this.fileStartTime = Date.now();
    // Extract test category from filename (e.g., "03-nmea0183.test.js" -> "NMEA 0183")
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

  onTestFileResult(test, testResult, results) {
    const duration = ((Date.now() - this.fileStartTime) / 1000).toFixed(1);
    const passed = testResult.numPassingTests;
    const failed = testResult.numFailingTests;
    const total = passed + failed;

    // Clear the "..." and show results
    if (failed > 0) {
      this.log(` FAIL (${passed}/${total} passed, ${duration}s)\n`);
      // Show failure details
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

    // Store results for report
    const testInfo = {
      file: path.basename(testResult.testFilePath),
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

    // Print summary
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

    // Generate reports
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
    const image = process.env.SIGNALK_IMAGE || 'signalk/signalk-server:latest';
    const summary = this.results.summary;
    const duration = (summary.duration / 1000).toFixed(1);

    let md = `# SignalK Server Release Validation Report\n\n`;
    md += `**Image:** \`${image}\`\n`;
    md += `**Date:** ${this.results.startTime}\n`;
    md += `**Duration:** ${duration}s\n\n`;

    // Summary table
    md += `## Summary\n\n`;
    md += `| Metric | Value |\n`;
    md += `|--------|-------|\n`;
    md += `| Total Tests | ${summary.total} |\n`;
    md += `| Passed | ${summary.passed} |\n`;
    md += `| Failed | ${summary.failed} |\n`;
    md += `| Skipped | ${summary.skipped} |\n`;
    md += `| Status | ${summary.success ? 'PASSED' : 'FAILED'} |\n\n`;

    // Test categories
    md += `## Test Results\n\n`;
    md += `| Category | Tests | Passed | Failed | Duration |\n`;
    md += `|----------|-------|--------|--------|----------|\n`;

    for (const testFile of this.results.tests) {
      const passed = testFile.tests.filter((t) => t.status === 'passed').length;
      const failed = testFile.tests.filter((t) => t.status === 'failed').length;
      const status = failed > 0 ? 'FAIL' : 'OK';
      const dur = (testFile.duration / 1000).toFixed(1);
      const category = this.getTestCategory(testFile.file);
      md += `| ${status} ${category} | ${testFile.tests.length} | ${passed} | ${failed} | ${dur}s |\n`;
    }
    md += '\n';

    // Failures
    const failures = this.results.tests
      .flatMap((f) => f.tests)
      .filter((t) => t.status === 'failed');

    if (failures.length > 0) {
      md += `## Failures\n\n`;
      for (const failure of failures) {
        md += `### ${failure.fullName}\n\n`;
        md += '```\n';
        md += failure.failureMessages.join('\n').substring(0, 500);
        md += '\n```\n\n';
      }
    }

    // Recommendation
    md += `## Recommendation\n\n`;
    if (summary.success) {
      md += `**APPROVED FOR RELEASE**\n\n`;
      md += `All tests passed. The image is ready for release.\n`;
    } else {
      md += `**NOT APPROVED FOR RELEASE**\n\n`;
      md += `${summary.failed} test(s) failed. Please review the failures above.\n`;
    }

    const reportPath = path.join(this.outputDir, 'summary.md');
    fs.writeFileSync(reportPath, md);
  }

  generateHtmlReport() {
    const image = process.env.SIGNALK_IMAGE || 'signalk/signalk-server:latest';
    const summary = this.results.summary;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SignalK Release Validation Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 40px; background: #fafafa; }
    .container { max-width: 900px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    h1 { color: #333; margin-bottom: 10px; }
    .meta { color: #666; margin-bottom: 20px; }
    .summary { background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0; display: flex; gap: 30px; }
    .stat { text-align: center; }
    .stat-value { font-size: 28px; font-weight: bold; }
    .stat-label { color: #666; font-size: 14px; }
    .passed { color: #22c55e; }
    .failed { color: #ef4444; }
    table { border-collapse: collapse; width: 100%; margin: 20px 0; }
    th, td { border: 1px solid #e5e5e5; padding: 12px; text-align: left; }
    th { background: #f5f5f5; font-weight: 600; }
    tr:hover { background: #fafafa; }
    .status-ok { color: #22c55e; font-weight: bold; }
    .status-fail { color: #ef4444; font-weight: bold; }
    .badge { display: inline-block; padding: 6px 16px; border-radius: 20px; font-weight: bold; font-size: 14px; }
    .badge-passed { background: #dcfce7; color: #166534; }
    .badge-failed { background: #fee2e2; color: #991b1b; }
    pre { background: #1e1e1e; color: #d4d4d4; padding: 15px; border-radius: 8px; overflow-x: auto; font-size: 13px; }
    .failure { margin: 20px 0; padding: 15px; background: #fef2f2; border-left: 4px solid #ef4444; border-radius: 4px; }
    .failure h4 { margin: 0 0 10px 0; color: #991b1b; }
  </style>
</head>
<body>
  <div class="container">
    <h1>SignalK Release Validation Report</h1>
    <div class="meta">
      <p><strong>Image:</strong> <code>${image}</code></p>
      <p><strong>Date:</strong> ${this.results.startTime}</p>
    </div>

    <div class="summary">
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
          ${summary.success ? 'PASSED' : 'FAILED'}
        </span>
      </div>
    </div>

    <h2>Test Results</h2>
    <table>
      <tr>
        <th>Category</th>
        <th>Tests</th>
        <th>Passed</th>
        <th>Failed</th>
        <th>Duration</th>
      </tr>
      ${this.results.tests
        .map((t) => {
          const passed = t.tests.filter((x) => x.status === 'passed').length;
          const failed = t.tests.filter((x) => x.status === 'failed').length;
          const category = this.getTestCategory(t.file);
          return `<tr>
            <td><span class="${failed > 0 ? 'status-fail' : 'status-ok'}">${failed > 0 ? 'FAIL' : 'OK'}</span> ${category}</td>
            <td>${t.tests.length}</td>
            <td class="passed">${passed}</td>
            <td class="failed">${failed}</td>
            <td>${(t.duration / 1000).toFixed(1)}s</td>
          </tr>`;
        })
        .join('\n')}
    </table>

    ${
      summary.failed > 0
        ? `
    <h2>Failures</h2>
    ${this.results.tests
      .flatMap((f) => f.tests)
      .filter((t) => t.status === 'failed')
      .map(
        (t) => `
      <div class="failure">
        <h4>${t.fullName}</h4>
        <pre>${t.failureMessages.join('\n').substring(0, 1000).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
      </div>
    `
      )
      .join('\n')}
    `
        : ''
    }
  </div>
</body>
</html>`;

    const reportPath = path.join(this.outputDir, 'report.html');
    fs.writeFileSync(reportPath, html);
  }
}

module.exports = CustomReporter;
