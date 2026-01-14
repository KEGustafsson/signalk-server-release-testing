#!/usr/bin/env node

/**
 * Report Generation Script
 *
 * Generates validation reports from test results
 */

const fs = require('fs-extra');
const path = require('path');

const args = process.argv.slice(2);
const options = {};

// Parse command line arguments
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg.startsWith('--')) {
    const [key, value] = arg.slice(2).split('=');
    options[key] = value || true;
  }
}

const reportsDir = path.join(__dirname, '..', 'reports');
const artifactsDir = path.join(__dirname, '..', 'artifacts');

async function generateReport() {
  console.log('Generating validation report...');

  const image = options.image || process.env.SIGNALK_IMAGE || 'signalk/signalk-server:latest';
  const timestamp = new Date().toISOString();

  // Collect results from test runs
  const results = {
    image,
    timestamp,
    categories: {},
    summary: {
      passed: 0,
      failed: 0,
      total: 0,
    },
  };

  // Parse category results from args
  const categories = ['lifecycle', 'plugins', 'nmea-tcp', 'nmea-udp', 'scenarios', 'ui'];
  for (const cat of categories) {
    const result = options[cat];
    if (result) {
      results.categories[cat] = {
        status: result === 'success' ? 'passed' : 'failed',
      };
      if (result === 'success') {
        results.summary.passed++;
      } else {
        results.summary.failed++;
      }
      results.summary.total++;
    }
  }

  // Check for existing results.json
  const existingResults = path.join(reportsDir, 'results.json');
  if (await fs.pathExists(existingResults)) {
    const existing = await fs.readJson(existingResults);
    results.tests = existing.tests || [];
    results.summary = existing.summary || results.summary;
  }

  // Generate summary markdown
  let md = `# SignalK Server Release Validation Report\n\n`;
  md += `**Image:** \`${image}\`\n`;
  md += `**Generated:** ${timestamp}\n\n`;

  md += `## Summary\n\n`;
  const overallStatus = results.summary.failed === 0 ? '✅ PASSED' : '❌ FAILED';
  md += `**Overall Status:** ${overallStatus}\n\n`;

  md += `| Metric | Value |\n`;
  md += `|--------|-------|\n`;
  md += `| Total Categories | ${results.summary.total} |\n`;
  md += `| Passed | ${results.summary.passed} |\n`;
  md += `| Failed | ${results.summary.failed} |\n\n`;

  if (Object.keys(results.categories).length > 0) {
    md += `## Test Categories\n\n`;
    md += `| Category | Status |\n`;
    md += `|----------|--------|\n`;
    for (const [cat, data] of Object.entries(results.categories)) {
      const icon = data.status === 'passed' ? '✅' : '❌';
      md += `| ${cat} | ${icon} ${data.status} |\n`;
    }
    md += '\n';
  }

  md += `## Recommendation\n\n`;
  if (results.summary.failed === 0) {
    md += `✅ **APPROVED FOR RELEASE**\n\n`;
    md += `All validation tests passed. The Docker image is ready for release.\n`;
  } else {
    md += `❌ **NOT APPROVED FOR RELEASE**\n\n`;
    md += `${results.summary.failed} test category(s) failed. Please review and fix before release.\n`;
  }

  // Write reports
  await fs.ensureDir(reportsDir);
  await fs.writeFile(path.join(reportsDir, 'summary.md'), md);
  await fs.writeJson(path.join(reportsDir, 'final-results.json'), results, { spaces: 2 });

  console.log(`Report generated: ${path.join(reportsDir, 'summary.md')}`);
  console.log(`Results: ${results.summary.passed}/${results.summary.total} passed`);

  // Exit with error code if tests failed
  if (results.summary.failed > 0) {
    process.exit(1);
  }
}

generateReport().catch((err) => {
  console.error('Report generation failed:', err);
  process.exit(1);
});
