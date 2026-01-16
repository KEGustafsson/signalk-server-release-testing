/**
 * CustomReporter - Jest reporter for validation reports
 *
 * Provides real-time test progress during runs and generates
 * detailed reports in multiple formats. Supports GitHub Actions annotations.
 */

const fs = require('fs-extra');
const path = require('path');

class CustomReporter {
  constructor(globalConfig, options) {
    this._globalConfig = globalConfig;
    this._options = options || {};
    this.outputDir = options.outputDir || './reports';
    this.isGitHubActions = !!process.env.GITHUB_ACTIONS;
    this.results = {
      startTime: null,
      endTime: null,
      image: process.env.SIGNALK_IMAGE || 'signalk/signalk-server:latest',
      tests: [],
      summary: {},
    };
    this.currentFile = null;
    this.fileStartTime = null;
    this.currentTestCount = 0;
    this.currentFileTests = [];
  }

  log(message) {
    process.stdout.write(message);
  }

  // GitHub Actions specific logging
  ghGroup(name) {
    if (this.isGitHubActions) {
      this.log(`::group::${name}\n`);
    }
  }

  ghEndGroup() {
    if (this.isGitHubActions) {
      this.log(`::endgroup::\n`);
    }
  }

  ghError(message, file, line) {
    if (this.isGitHubActions) {
      const location = file ? `file=${file}${line ? `,line=${line}` : ''}` : '';
      this.log(`::error ${location}::${message.replace(/\n/g, '%0A')}\n`);
    }
  }

  ghWarning(message) {
    if (this.isGitHubActions) {
      this.log(`::warning::${message}\n`);
    }
  }

  ghNotice(message) {
    if (this.isGitHubActions) {
      this.log(`::notice::${message}\n`);
    }
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

    if (this.isGitHubActions) {
      this.log(`::notice::Starting SignalK validation for ${this.results.image}\n`);
    }
  }

  onTestFileStart(test) {
    this.currentFile = path.basename(test.path);
    this.fileStartTime = Date.now();
    this.currentTestCount = 0;
    this.currentFileTests = [];
    const category = this.getTestCategory(this.currentFile);

    this.log('\n');
    this.log(`  ┌─ ${category}\n`);
    this.log(`  │  ${this.getCategoryDescription(this.currentFile)}\n`);
    this.log(`  │\n`);

    this.ghGroup(category);
  }

  onTestStart(test) {
    // Called when individual test starts - we don't use this as Jest doesn't provide it reliably
  }

  onTestCaseResult(test, testCaseResult) {
    // Called after each individual test completes
    this.currentTestCount++;
    const status = testCaseResult.status;
    const duration = testCaseResult.duration || 0;
    const title = testCaseResult.title;

    let icon, color;
    switch (status) {
      case 'passed':
        icon = '✓';
        color = '\x1b[32m'; // green
        break;
      case 'failed':
        icon = '✗';
        color = '\x1b[31m'; // red
        break;
      case 'pending':
      case 'skipped':
        icon = '○';
        color = '\x1b[33m'; // yellow
        break;
      default:
        icon = '?';
        color = '\x1b[90m'; // gray
    }

    const reset = '\x1b[0m';
    const gray = '\x1b[90m';

    // Show real-time progress for each test
    this.log(`  │  ${color}${icon}${reset} ${title} ${gray}(${duration}ms)${reset}\n`);

    // GitHub Actions annotation for failures
    if (status === 'failed' && testCaseResult.failureMessages.length > 0) {
      const errorMsg = testCaseResult.failureMessages[0].split('\n')[0];
      this.ghError(`${testCaseResult.fullName}: ${errorMsg}`, this.currentFile);
    }

    this.currentFileTests.push({
      name: title,
      fullName: testCaseResult.fullName,
      status: status,
      duration: duration,
      failureMessages: testCaseResult.failureMessages || [],
    });
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
    const skipped = testResult.numPendingTests;
    const total = passed + failed + skipped;

    this.log(`  │\n`);

    if (failed > 0) {
      this.log(`  └─ \x1b[31mFAILED\x1b[0m ${passed}/${total} passed, ${failed} failed (${duration}s)\n`);
    } else if (skipped > 0) {
      this.log(`  └─ \x1b[32mPASSED\x1b[0m ${passed}/${total} passed, ${skipped} skipped (${duration}s)\n`);
    } else {
      this.log(`  └─ \x1b[32mPASSED\x1b[0m ${passed}/${total} passed (${duration}s)\n`);
    }

    this.ghEndGroup();

    // Use tests from onTestCaseResult if available, otherwise fall back to testResult
    const tests = this.currentFileTests.length > 0
      ? this.currentFileTests
      : testResult.testResults.map((t) => ({
          name: t.title,
          fullName: t.fullName,
          status: t.status,
          duration: t.duration,
          failureMessages: t.failureMessages,
        }));

    const testInfo = {
      file: path.basename(testResult.testFilePath),
      category: this.getTestCategory(path.basename(testResult.testFilePath)),
      description: this.getCategoryDescription(path.basename(testResult.testFilePath)),
      duration: testResult.perfStats.end - testResult.perfStats.start,
      status: testResult.numFailingTests > 0 ? 'failed' : 'passed',
      tests: tests,
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
    const { passed, failed, skipped, total } = this.results.summary;

    this.log('\n');
    this.log('════════════════════════════════════════════════════════════════\n');
    this.log('                         SUMMARY\n');
    this.log('════════════════════════════════════════════════════════════════\n');
    this.log('\n');

    // Category summary table
    this.log('  Category Results:\n');
    this.log('  ─────────────────────────────────────────────────────────────\n');

    for (const testFile of this.results.tests) {
      const p = testFile.tests.filter((t) => t.status === 'passed').length;
      const f = testFile.tests.filter((t) => t.status === 'failed').length;
      const icon = f > 0 ? '\x1b[31m✗\x1b[0m' : '\x1b[32m✓\x1b[0m';
      const dur = (testFile.duration / 1000).toFixed(1);
      this.log(`  ${icon} ${testFile.category.padEnd(30)} ${p}/${testFile.tests.length} passed  (${dur}s)\n`);
    }

    this.log('\n');
    this.log('  ─────────────────────────────────────────────────────────────\n');
    this.log(`  Total:    ${total} tests\n`);
    this.log(`  Passed:   \x1b[32m${passed}\x1b[0m\n`);
    if (failed > 0) {
      this.log(`  Failed:   \x1b[31m${failed}\x1b[0m\n`);
    } else {
      this.log(`  Failed:   ${failed}\n`);
    }
    if (skipped > 0) {
      this.log(`  Skipped:  \x1b[33m${skipped}\x1b[0m\n`);
    }
    this.log(`  Duration: ${duration}s\n`);
    this.log('\n');

    if (failed === 0) {
      this.log('  ┌────────────────────────────────────────────────────────────┐\n');
      this.log('  │  \x1b[32m✓ ALL TESTS PASSED - APPROVED FOR RELEASE\x1b[0m               │\n');
      this.log('  └────────────────────────────────────────────────────────────┘\n');
      this.ghNotice(`All ${total} tests passed. Image ${this.results.image} is approved for release.`);
    } else {
      this.log('  ┌────────────────────────────────────────────────────────────┐\n');
      this.log('  │  \x1b[31m✗ TESTS FAILED - NOT APPROVED FOR RELEASE\x1b[0m               │\n');
      this.log('  └────────────────────────────────────────────────────────────┘\n');

      // List failures
      this.log('\n  Failed Tests:\n');
      for (const testFile of this.results.tests) {
        for (const t of testFile.tests) {
          if (t.status === 'failed') {
            this.log(`  \x1b[31m✗\x1b[0m ${testFile.category} > ${t.name}\n`);
            if (t.failureMessages.length > 0) {
              const firstLine = t.failureMessages[0].split('\n')[0].substring(0, 70);
              this.log(`    \x1b[90m${firstLine}\x1b[0m\n`);
            }
          }
        }
      }

      this.ghError(`${failed} of ${total} tests failed. Image ${this.results.image} is NOT approved for release.`);
    }

    this.log('\n');

    this.generateJsonReport();
    this.generateMarkdownReport();
    this.generateHtmlReport();
    this.generateGitHubSummary();

    this.log(`  Reports saved to: ${this.outputDir}/\n`);
    this.log('\n');
  }

  generateJsonReport() {
    const reportPath = path.join(this.outputDir, 'results.json');
    fs.writeJsonSync(reportPath, this.results, { spaces: 2 });
  }

  generateGitHubSummary() {
    // Generate GitHub Actions Job Summary if running in CI
    if (!this.isGitHubActions) return;

    const summaryFile = process.env.GITHUB_STEP_SUMMARY;
    if (!summaryFile) return;

    const summary = this.results.summary;
    const duration = (summary.duration / 1000).toFixed(1);

    let md = `## SignalK Server Release Validation\n\n`;
    md += `| Metric | Value |\n|--------|-------|\n`;
    md += `| Image | \`${this.results.image}\` |\n`;
    md += `| Status | ${summary.success ? '✅ **PASSED**' : '❌ **FAILED**'} |\n`;
    md += `| Tests | ${summary.passed}/${summary.total} passed |\n`;
    md += `| Duration | ${duration}s |\n\n`;

    if (summary.failed > 0) {
      md += `### ❌ Failed Tests\n\n`;
      for (const testFile of this.results.tests) {
        for (const t of testFile.tests) {
          if (t.status === 'failed') {
            md += `- **${testFile.category}**: ${t.name}\n`;
          }
        }
      }
      md += '\n';
    }

    md += `### Test Categories\n\n`;
    md += `| Status | Category | Tests | Duration |\n`;
    md += `|--------|----------|-------|----------|\n`;

    for (const testFile of this.results.tests) {
      const passed = testFile.tests.filter((t) => t.status === 'passed').length;
      const failed = testFile.tests.filter((t) => t.status === 'failed').length;
      const status = failed > 0 ? '❌' : '✅';
      const dur = (testFile.duration / 1000).toFixed(1);
      md += `| ${status} | ${testFile.category} | ${passed}/${testFile.tests.length} | ${dur}s |\n`;
    }

    md += `\n<details><summary>View detailed test results</summary>\n\n`;

    for (const testFile of this.results.tests) {
      md += `#### ${testFile.category}\n\n`;
      for (const t of testFile.tests) {
        const icon = t.status === 'passed' ? '✅' : t.status === 'failed' ? '❌' : '⏭️';
        md += `- ${icon} ${t.name} (${t.duration || 0}ms)\n`;
      }
      md += '\n';
    }

    md += `</details>\n`;

    fs.appendFileSync(summaryFile, md);
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
        const testStatus = test.status === 'passed' ? '✅' : test.status === 'failed' ? '❌' : '⏭️';
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
    const duration = (summary.duration / 1000).toFixed(1);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SignalK Release Validation Report</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
    .container { max-width: 1200px; margin: 0 auto; }
    .header { background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%); color: white; padding: 30px; border-radius: 12px; margin-bottom: 20px; }
    .header h1 { margin: 0 0 10px 0; font-size: 28px; }
    .header .meta { opacity: 0.9; font-size: 14px; }
    .card { background: white; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); margin-bottom: 20px; overflow: hidden; }
    .card-header { padding: 16px 20px; background: #f8f9fa; border-bottom: 1px solid #e9ecef; font-weight: 600; font-size: 16px; display: flex; align-items: center; gap: 10px; }
    .card-body { padding: 20px; }
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 16px; }
    .stat { text-align: center; padding: 20px 15px; background: #f8f9fa; border-radius: 10px; }
    .stat-value { font-size: 36px; font-weight: bold; color: #333; }
    .stat-label { color: #666; font-size: 13px; margin-top: 5px; text-transform: uppercase; letter-spacing: 0.5px; }
    .stat-value.passed { color: #22c55e; }
    .stat-value.failed { color: #ef4444; }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 10px 24px; border-radius: 24px; font-weight: 600; font-size: 16px; }
    .badge-passed { background: #dcfce7; color: #166534; }
    .badge-failed { background: #fee2e2; color: #991b1b; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 14px 16px; text-align: left; border-bottom: 1px solid #e9ecef; }
    th { background: #f8f9fa; font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: #666; }
    .status-icon { font-size: 18px; width: 30px; }
    .category-row { cursor: pointer; transition: background 0.15s; }
    .category-row:hover { background: #f0f7ff; }
    .category-name { font-weight: 600; color: #333; }
    .category-desc { font-size: 13px; color: #666; margin-top: 2px; }
    .toggle-icon { transition: transform 0.2s; color: #999; }
    .category-row.open .toggle-icon { transform: rotate(90deg); }
    .test-details { display: none; background: #fafbfc; }
    .test-details.open { display: table-row; }
    .test-details td { padding: 0; }
    .test-list { margin: 0; padding: 16px 20px 16px 60px; list-style: none; }
    .test-item { padding: 8px 12px; margin: 4px 0; background: white; border-radius: 6px; display: flex; align-items: center; gap: 10px; font-size: 14px; }
    .test-item.passed { border-left: 3px solid #22c55e; }
    .test-item.failed { border-left: 3px solid #ef4444; background: #fef2f2; }
    .test-item.pending { border-left: 3px solid #f59e0b; }
    .test-name { flex: 1; }
    .test-duration { color: #999; font-size: 12px; }
    .env-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
    .env-item { background: #f8f9fa; padding: 12px 16px; border-radius: 8px; }
    .env-label { font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }
    .env-value { font-weight: 500; margin-top: 4px; }
    .env-value code { background: #e9ecef; padding: 2px 8px; border-radius: 4px; font-size: 13px; }
    .failure-section { margin-top: 20px; }
    .failure { margin: 12px 0; padding: 16px; background: #fef2f2; border-left: 4px solid #ef4444; border-radius: 8px; }
    .failure h4 { margin: 0 0 12px 0; color: #991b1b; font-size: 14px; }
    pre { background: #1e1e1e; color: #d4d4d4; padding: 16px; border-radius: 8px; overflow-x: auto; font-size: 12px; margin: 0; line-height: 1.5; }
    .recommendation { padding: 24px; border-radius: 12px; }
    .recommendation.passed { background: linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%); }
    .recommendation.failed { background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%); }
    .recommendation h3 { margin: 0 0 8px 0; display: flex; align-items: center; gap: 8px; }
    .recommendation p { margin: 0; opacity: 0.9; }
    .progress-bar { height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden; margin-top: 8px; }
    .progress-fill { height: 100%; border-radius: 4px; transition: width 0.3s; }
    .progress-fill.passed { background: #22c55e; }
    .progress-fill.failed { background: #ef4444; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>SignalK Server Release Validation</h1>
      <div class="meta">
        <strong>${this.results.image}</strong> • ${new Date(this.results.startTime).toLocaleString()} • ${duration}s
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <span>📊</span> Summary
      </div>
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
            <div class="stat-value ${summary.failed > 0 ? 'failed' : ''}">${summary.failed}</div>
            <div class="stat-label">Failed</div>
          </div>
          <div class="stat">
            <div class="stat-value">${duration}s</div>
            <div class="stat-label">Duration</div>
          </div>
          <div class="stat">
            <span class="badge ${summary.success ? 'badge-passed' : 'badge-failed'}">
              ${summary.success ? '✅ PASSED' : '❌ FAILED'}
            </span>
          </div>
        </div>
        <div class="progress-bar">
          <div class="progress-fill ${summary.success ? 'passed' : 'failed'}" style="width: ${(summary.passed / summary.total * 100).toFixed(1)}%"></div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <span>🖥️</span> Environment
      </div>
      <div class="card-body">
        <div class="env-grid">
          <div class="env-item">
            <div class="env-label">Docker Image</div>
            <div class="env-value"><code>${this.results.image}</code></div>
          </div>
          <div class="env-item">
            <div class="env-label">Test Date</div>
            <div class="env-value">${new Date(this.results.startTime).toLocaleString()}</div>
          </div>
          <div class="env-item">
            <div class="env-label">Node.js Version</div>
            <div class="env-value">${process.version}</div>
          </div>
          <div class="env-item">
            <div class="env-label">Platform</div>
            <div class="env-value">${process.platform}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <span>🧪</span> Test Results
      </div>
      <div class="card-body" style="padding: 0;">
        <table>
          <thead>
            <tr>
              <th style="width: 40px;"></th>
              <th>Category</th>
              <th style="width: 100px;">Tests</th>
              <th style="width: 100px;">Duration</th>
              <th style="width: 40px;"></th>
            </tr>
          </thead>
          <tbody>
            ${this.results.tests.map((t, idx) => {
              const passed = t.tests.filter((x) => x.status === 'passed').length;
              const failed = t.tests.filter((x) => x.status === 'failed').length;
              return `
                <tr class="category-row" onclick="toggleTests(${idx})">
                  <td class="status-icon">${failed > 0 ? '❌' : '✅'}</td>
                  <td>
                    <div class="category-name">${t.category}</div>
                    <div class="category-desc">${t.description}</div>
                  </td>
                  <td><strong>${passed}</strong>/${t.tests.length}</td>
                  <td>${(t.duration / 1000).toFixed(1)}s</td>
                  <td><span class="toggle-icon">▶</span></td>
                </tr>
                <tr class="test-details" id="tests-${idx}">
                  <td colspan="5">
                    <div class="test-list">
                      ${t.tests.map(test => `
                        <div class="test-item ${test.status}">
                          <span>${test.status === 'passed' ? '✅' : test.status === 'failed' ? '❌' : '⏭️'}</span>
                          <span class="test-name">${test.name}</span>
                          <span class="test-duration">${test.duration || 0}ms</span>
                        </div>
                      `).join('')}
                    </div>
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
      <div class="card-header" style="background: #fef2f2; color: #991b1b;">
        <span>❌</span> Failures (${summary.failed})
      </div>
      <div class="card-body">
        ${this.results.tests
          .flatMap((f) => f.tests.map(t => ({...t, category: f.category})))
          .filter((t) => t.status === 'failed')
          .map(t => `
            <div class="failure">
              <h4>${t.category} › ${t.name}</h4>
              <pre>${(t.failureMessages.join('\n') || 'No error message').substring(0, 1500).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
            </div>
          `).join('')}
      </div>
    </div>
    ` : ''}

    <div class="recommendation ${summary.success ? 'passed' : 'failed'}">
      ${summary.success
        ? `<h3>✅ APPROVED FOR RELEASE</h3>
           <p>All ${summary.total} tests passed successfully. The image <code>${this.results.image}</code> is ready for release.</p>`
        : `<h3>❌ NOT APPROVED FOR RELEASE</h3>
           <p>${summary.failed} out of ${summary.total} tests failed. Please review and fix the failures before releasing.</p>`
      }
    </div>
  </div>

  <script>
    function toggleTests(idx) {
      const row = document.getElementById('tests-' + idx);
      const categoryRow = row.previousElementSibling;
      row.classList.toggle('open');
      categoryRow.classList.toggle('open');
    }
    // Expand failed categories by default
    document.querySelectorAll('.category-row').forEach((row, idx) => {
      if (row.querySelector('.status-icon').textContent.includes('❌')) {
        toggleTests(idx);
      }
    });
  </script>
</body>
</html>`;

    const reportPath = path.join(this.outputDir, 'report.html');
    fs.writeFileSync(reportPath, html);
  }
}

module.exports = CustomReporter;
