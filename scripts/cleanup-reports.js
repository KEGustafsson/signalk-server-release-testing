#!/usr/bin/env node
/**
 * Cleanup Reports Script
 *
 * Removes old report files before running tests.
 * Ensures clean state for each test run.
 */

const fs = require('fs-extra');
const path = require('path');

const reportsDir = path.join(__dirname, '..', 'reports');

async function cleanup() {
  console.log('Cleaning up reports directory...');

  try {
    // Remove existing reports if directory exists
    if (await fs.pathExists(reportsDir)) {
      // Remove all files in reports directory
      const items = await fs.readdir(reportsDir);
      for (const item of items) {
        const itemPath = path.join(reportsDir, item);
        await fs.remove(itemPath);
        console.log(`  Removed: ${item}`);
      }
    }

    // Recreate directory structure
    await fs.ensureDir(reportsDir);
    await fs.ensureDir(path.join(reportsDir, 'screenshots'));
    await fs.ensureDir(path.join(reportsDir, 'logs'));

    console.log('Reports directory cleaned and ready.');
  } catch (error) {
    console.error('Error cleaning reports:', error.message);
    process.exit(1);
  }
}

cleanup();
