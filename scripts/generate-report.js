#!/usr/bin/env node

/**
 * Generate consolidated validation report from multiple test job results
 *
 * Usage: node scripts/generate-report.js --image=<image> --artifacts=<path> [--job=status ...]
 */

const fs = require('fs-extra');
const path = require('path');

// Parse command line arguments
function parseArgs() {
  const args = {};
  process.argv.slice(2).forEach(arg => {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      args[key] = value || true;
    }
  });
  return args;
}

// Load results.json files from artifact directories
function loadResults(artifactsPath) {
  const results = [];

  if (!fs.existsSync(artifactsPath)) {
    console.log(`Artifacts path not found: ${artifactsPath}`);
    return results;
  }

  const dirs = fs.readdirSync(artifactsPath);
  for (const dir of dirs) {
    const resultsFile = path.join(artifactsPath, dir, 'results.json');
    if (fs.existsSync(resultsFile)) {
      try {
        const data = fs.readJsonSync(resultsFile);
        results.push(data);
        console.log(`Loaded results from ${dir}`);
      } catch (e) {
        console.warn(`Failed to load ${resultsFile}: ${e.message}`);
      }
    }
  }

  return results;
}

// Merge multiple result files into one consolidated report
function mergeResults(resultFiles, image) {
  const merged = {
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    image: image,
    tests: [],
    summary: {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      duration: 0,
      success: true,
    },
  };

  // Find earliest start and latest end time
  let earliestStart = null;
  let latestEnd = null;

  for (const result of resultFiles) {
    if (result.startTime) {
      const start = new Date(result.startTime);
      if (!earliestStart || start < earliestStart) {
        earliestStart = start;
      }
    }
    if (result.endTime) {
      const end = new Date(result.endTime);
      if (!latestEnd || end > latestEnd) {
        latestEnd = end;
      }
    }

    // Merge test categories
    if (result.tests && Array.isArray(result.tests)) {
      merged.tests.push(...result.tests);
    }

    // Aggregate summary
    if (result.summary) {
      merged.summary.total += result.summary.total || 0;
      merged.summary.passed += result.summary.passed || 0;
      merged.summary.failed += result.summary.failed || 0;
      merged.summary.skipped += result.summary.skipped || 0;
      merged.summary.duration += result.summary.duration || 0;
      if (!result.summary.success) {
        merged.summary.success = false;
      }
    }
  }

  if (earliestStart) {
    merged.startTime = earliestStart.toISOString();
  }
  if (latestEnd) {
    merged.endTime = latestEnd.toISOString();
  }

  return merged;
}

// Generate markdown report
function generateMarkdown(results) {
  const summary = results.summary;
  const duration = (summary.duration / 1000).toFixed(1);

  let md = `# SignalK Server Release Validation Report\n\n`;

  // Environment
  md += `## Environment\n\n`;
  md += `| Property | Value |\n`;
  md += `|----------|-------|\n`;
  md += `| Image | \`${results.image}\` |\n`;
  md += `| Date | ${results.startTime} |\n`;
  md += `| Duration | ${duration}s |\n`;
  md += `| Platform | GitHub Actions |\n\n`;

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

  for (const testFile of results.tests) {
    const passed = testFile.tests ? testFile.tests.filter((t) => t.status === 'passed').length : 0;
    const failed = testFile.tests ? testFile.tests.filter((t) => t.status === 'failed').length : 0;
    const total = testFile.tests ? testFile.tests.length : 0;
    const status = failed > 0 ? '❌' : '✅';
    const dur = ((testFile.duration || 0) / 1000).toFixed(1);
    md += `| ${status} | ${testFile.category} | ${testFile.description || ''} | ${passed}/${total} | ${dur}s |\n`;
  }
  md += '\n';

  // Detailed Test Results
  md += `## Detailed Test Results\n\n`;

  for (const testFile of results.tests) {
    const failed = testFile.tests ? testFile.tests.filter((t) => t.status === 'failed').length : 0;
    const status = failed > 0 ? '❌' : '✅';

    md += `### ${status} ${testFile.category}\n\n`;
    if (testFile.description) {
      md += `${testFile.description}\n\n`;
    }
    md += `| Status | Test | Duration |\n`;
    md += `|--------|------|----------|\n`;

    if (testFile.tests) {
      for (const test of testFile.tests) {
        const testStatus = test.status === 'passed' ? '✅' : test.status === 'failed' ? '❌' : '⏭️';
        const testDur = test.duration ? `${test.duration}ms` : '-';
        md += `| ${testStatus} | ${test.name} | ${testDur} |\n`;
      }
    }
    md += '\n';
  }

  // Failures section
  const failures = results.tests
    .flatMap((f) => f.tests || [])
    .filter((t) => t.status === 'failed');

  if (failures.length > 0) {
    md += `## ❌ Failures\n\n`;
    for (const failure of failures) {
      md += `### ${failure.fullName || failure.name}\n\n`;
      md += '```\n';
      md += (failure.failureMessages || []).join('\n').substring(0, 1000);
      md += '\n```\n\n';
    }
  }

  // Recommendation
  md += `## Recommendation\n\n`;
  if (summary.success) {
    md += `### ✅ APPROVED FOR RELEASE\n\n`;
    md += `All ${summary.total} tests passed. The image \`${results.image}\` is ready for release.\n`;
  } else {
    md += `### ❌ NOT APPROVED FOR RELEASE\n\n`;
    md += `${summary.failed} out of ${summary.total} tests failed. Please review the failures above before releasing.\n`;
  }

  return md;
}

// Generate HTML report
function generateHtml(results) {
  const summary = results.summary;
  const duration = (summary.duration / 1000).toFixed(1);
  const passPercent = summary.total > 0 ? (summary.passed / summary.total * 100).toFixed(1) : 0;

  const testsHtml = results.tests.map((t, idx) => {
    const passed = t.tests ? t.tests.filter((x) => x.status === 'passed').length : 0;
    const failed = t.tests ? t.tests.filter((x) => x.status === 'failed').length : 0;
    const total = t.tests ? t.tests.length : 0;
    const testItems = (t.tests || []).map(test => 
      `<div class="test-item ${test.status}">
        <span>${test.status === 'passed' ? '✅' : test.status === 'failed' ? '❌' : '⏭️'}</span>
        <span class="test-name">${test.name}</span>
        <span class="test-duration">${test.duration || 0}ms</span>
      </div>`
    ).join('');
    
    return `
      <tr class="category-row" onclick="toggleTests(${idx})">
        <td class="status-icon">${failed > 0 ? '❌' : '✅'}</td>
        <td>
          <div class="category-name">${t.category}</div>
          <div class="category-desc">${t.description || ''}</div>
        </td>
        <td><strong>${passed}</strong>/${total}</td>
        <td>${((t.duration || 0) / 1000).toFixed(1)}s</td>
        <td><span class="toggle-icon">▶</span></td>
      </tr>
      <tr class="test-details" id="tests-${idx}">
        <td colspan="5">
          <div class="test-list">${testItems}</div>
        </td>
      </tr>`;
  }).join('');

  const failuresHtml = summary.failed > 0 ? `
    <div class="card">
      <div class="card-header" style="background: #fef2f2; color: #991b1b;">
        <span>❌</span> Failures (${summary.failed})
      </div>
      <div class="card-body">
        ${results.tests
          .flatMap((f) => (f.tests || []).map(t => ({...t, category: f.category})))
          .filter((t) => t.status === 'failed')
          .map(t => `
            <div class="failure">
              <h4>${t.category} › ${t.name}</h4>
              <pre>${((t.failureMessages || []).join('\n') || 'No error message').substring(0, 1500).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
            </div>
          `).join('')}
      </div>
    </div>` : '';

  return `<!DOCTYPE html>
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
    .failure { margin: 12px 0; padding: 16px; background: #fef2f2; border-left: 4px solid #ef4444; border-radius: 8px; }
    .failure h4 { margin: 0 0 12px 0; color: #991b1b; font-size: 14px; }
    pre { background: #1e1e1e; color: #d4d4d4; padding: 16px; border-radius: 8px; overflow-x: auto; font-size: 12px; margin: 0; line-height: 1.5; }
    .recommendation { padding: 24px; border-radius: 12px; }
    .recommendation.passed { background: linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%); }
    .recommendation.failed { background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%); }
    .recommendation h3 { margin: 0 0 8px 0; }
    .recommendation p { margin: 0; opacity: 0.9; }
    .progress-bar { height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden; margin-top: 8px; }
    .progress-fill { height: 100%; border-radius: 4px; }
    .progress-fill.passed { background: #22c55e; }
    .progress-fill.failed { background: #ef4444; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>SignalK Server Release Validation</h1>
      <div class="meta">
        <strong>${results.image}</strong> • ${new Date(results.startTime).toLocaleString()} • ${duration}s
      </div>
    </div>

    <div class="card">
      <div class="card-header"><span>📊</span> Summary</div>
      <div class="card-body">
        <div class="summary-grid">
          <div class="stat"><div class="stat-value">${summary.total}</div><div class="stat-label">Total Tests</div></div>
          <div class="stat"><div class="stat-value passed">${summary.passed}</div><div class="stat-label">Passed</div></div>
          <div class="stat"><div class="stat-value ${summary.failed > 0 ? 'failed' : ''}">${summary.failed}</div><div class="stat-label">Failed</div></div>
          <div class="stat"><div class="stat-value">${duration}s</div><div class="stat-label">Duration</div></div>
          <div class="stat"><span class="badge ${summary.success ? 'badge-passed' : 'badge-failed'}">${summary.success ? '✅ PASSED' : '❌ FAILED'}</span></div>
        </div>
        <div class="progress-bar"><div class="progress-fill ${summary.success ? 'passed' : 'failed'}" style="width: ${passPercent}%"></div></div>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><span>🧪</span> Test Results</div>
      <div class="card-body" style="padding: 0;">
        <table>
          <thead><tr><th style="width: 40px;"></th><th>Category</th><th style="width: 100px;">Tests</th><th style="width: 100px;">Duration</th><th style="width: 40px;"></th></tr></thead>
          <tbody>${testsHtml}</tbody>
        </table>
      </div>
    </div>

    ${failuresHtml}

    <div class="recommendation ${summary.success ? 'passed' : 'failed'}">
      ${summary.success
        ? `<h3>✅ APPROVED FOR RELEASE</h3><p>All ${summary.total} tests passed. The image <code>${results.image}</code> is ready for release.</p>`
        : `<h3>❌ NOT APPROVED FOR RELEASE</h3><p>${summary.failed} out of ${summary.total} tests failed. Please fix the failures before releasing.</p>`}
    </div>
  </div>
  <script>
    function toggleTests(idx) {
      const row = document.getElementById('tests-' + idx);
      const categoryRow = row.previousElementSibling;
      row.classList.toggle('open');
      categoryRow.classList.toggle('open');
    }
    document.querySelectorAll('.category-row').forEach((row, idx) => {
      if (row.querySelector('.status-icon').textContent.includes('❌')) toggleTests(idx);
    });
  </script>
</body>
</html>`;
}

// Main
async function main() {
  const args = parseArgs();
  const image = args.image || 'signalk/signalk-server:latest';
  const artifactsPath = args.artifacts || 'artifacts/';

  console.log('Generating report for ' + image);
  console.log('Loading results from ' + artifactsPath);

  const resultFiles = loadResults(artifactsPath);
  if (resultFiles.length === 0) {
    console.warn('No result files found, generating empty report');
  }

  const merged = mergeResults(resultFiles, image);
  fs.ensureDirSync('reports');

  fs.writeJsonSync('reports/results.json', merged, { spaces: 2 });
  console.log('Generated reports/results.json');

  const markdown = generateMarkdown(merged);
  fs.writeFileSync('reports/summary.md', markdown);
  console.log('Generated reports/summary.md');

  const html = generateHtml(merged);
  fs.writeFileSync('reports/report.html', html);
  console.log('Generated reports/report.html');

  console.log('\nReport Summary:');
  console.log('  Total: ' + merged.summary.total);
  console.log('  Passed: ' + merged.summary.passed);
  console.log('  Failed: ' + merged.summary.failed);
  console.log('  Status: ' + (merged.summary.success ? 'PASSED' : 'FAILED'));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
