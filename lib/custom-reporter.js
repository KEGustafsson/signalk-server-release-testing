/**
 * CustomReporter - Jest reporter for validation reports
 *
 * Generates detailed reports in multiple formats for
 * release validation results.
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
  }

  onRunStart(results, options) {
    this.results.startTime = new Date().toISOString();
    fs.ensureDirSync(this.outputDir);
    fs.ensureDirSync(path.join(this.outputDir, 'screenshots'));
    fs.ensureDirSync(path.join(this.outputDir, 'logs'));
  }

  onTestResult(test, testResult, results) {
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

    // Generate reports
    this.generateJsonReport();
    this.generateMarkdownReport();
    this.generateHtmlReport();
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
    md += `| Status | ${summary.success ? '✅ PASSED' : '❌ FAILED'} |\n\n`;

    // Test categories
    md += `## Test Categories\n\n`;
    md += `| Category | Tests | Passed | Failed | Duration |\n`;
    md += `|----------|-------|--------|--------|----------|\n`;

    for (const testFile of this.results.tests) {
      const passed = testFile.tests.filter((t) => t.status === 'passed').length;
      const failed = testFile.tests.filter((t) => t.status === 'failed').length;
      const status = failed > 0 ? '❌' : '✅';
      const dur = (testFile.duration / 1000).toFixed(1);
      md += `| ${status} ${testFile.file} | ${testFile.tests.length} | ${passed} | ${failed} | ${dur}s |\n`;
    }
    md += '\n';

    // Failures
    const failures = this.results.tests
      .flatMap((f) => f.tests)
      .filter((t) => t.status === 'failed');

    if (failures.length > 0) {
      md += `## ❌ Failures\n\n`;
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
      md += `✅ **APPROVED FOR RELEASE**\n\n`;
      md += `All tests passed. The image is ready for release.\n`;
    } else {
      md += `❌ **NOT APPROVED FOR RELEASE**\n\n`;
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
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 40px; }
    h1 { color: #333; }
    .summary { background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .passed { color: #22c55e; }
    .failed { color: #ef4444; }
    table { border-collapse: collapse; width: 100%; margin: 20px 0; }
    th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
    th { background: #f0f0f0; }
    tr:nth-child(even) { background: #f9f9f9; }
    .status-badge { padding: 4px 12px; border-radius: 4px; font-weight: bold; }
    .status-passed { background: #dcfce7; color: #166534; }
    .status-failed { background: #fee2e2; color: #991b1b; }
    pre { background: #1e1e1e; color: #d4d4d4; padding: 15px; border-radius: 8px; overflow-x: auto; }
  </style>
</head>
<body>
  <h1>SignalK Server Release Validation Report</h1>
  
  <div class="summary">
    <p><strong>Image:</strong> <code>${image}</code></p>
    <p><strong>Date:</strong> ${this.results.startTime}</p>
    <p><strong>Duration:</strong> ${(summary.duration / 1000).toFixed(1)}s</p>
    <p><strong>Status:</strong> 
      <span class="status-badge ${summary.success ? 'status-passed' : 'status-failed'}">
        ${summary.success ? 'PASSED' : 'FAILED'}
      </span>
    </p>
  </div>

  <h2>Summary</h2>
  <table>
    <tr><th>Metric</th><th>Value</th></tr>
    <tr><td>Total Tests</td><td>${summary.total}</td></tr>
    <tr><td>Passed</td><td class="passed">${summary.passed}</td></tr>
    <tr><td>Failed</td><td class="failed">${summary.failed}</td></tr>
    <tr><td>Skipped</td><td>${summary.skipped}</td></tr>
  </table>

  <h2>Test Categories</h2>
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
        return `<tr>
          <td>${failed > 0 ? '❌' : '✅'} ${t.file}</td>
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
    <h3>${t.fullName}</h3>
    <pre>${t.failureMessages.join('\n').substring(0, 1000)}</pre>
  `
    )
    .join('\n')}
  `
      : ''
  }
</body>
</html>`;

    const reportPath = path.join(this.outputDir, 'report.html');
    fs.writeFileSync(reportPath, html);
  }
}

module.exports = CustomReporter;
