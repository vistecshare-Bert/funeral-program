/**
 * runTest.js — End-to-end test for the Vistec Funeral Tool pipeline.
 *
 * Usage:
 *   node test/runTest.js
 *
 * Prerequisites:
 *   - Drop 2–3 real JPG files into /uploads/test/ (test1.jpg, test2.jpg, test3.jpg)
 *   - npm install has been run
 *   - pip install -r requirements.txt has been run
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const PYTHON = process.env.PYTHON_PATH || 'python3';
const ROOT = path.join(__dirname, '..');
const ORDER_PATH = path.join(__dirname, 'testOrder.json');

console.log('=== Vistec Funeral Tool — Pipeline Test ===\n');

// ── 1. Validate test photos ──────────────────────────────────────────────────
const { validatePhotos } = require('../src/validator');

async function run() {
  // Check test photos exist
  const testPhotos = ['test1.jpg', 'test2.jpg', 'test3.jpg'].map(name => ({
    originalname: name,
    path: path.join(ROOT, 'uploads', 'test', name),
    size: 0
  }));

  const missing = testPhotos.filter(p => !fs.existsSync(p.path));
  if (missing.length > 0) {
    console.error(`ERROR: Missing test photos in /uploads/test/:`);
    missing.forEach(p => console.error(`  - ${p.originalname}`));
    console.error('\nDrop real JPG/PNG files there and re-run.');
    process.exit(1);
  }

  // Get real file sizes
  testPhotos.forEach(p => {
    p.size = fs.statSync(p.path).size;
  });

  console.log('Step 1: Photo Validation');
  console.log('─'.repeat(40));
  const validResult = await validatePhotos(testPhotos);
  console.log(`  Valid: ${validResult.validPhotos.length}/${testPhotos.length}`);
  if (validResult.warnings.length > 0) {
    validResult.warnings.forEach(w => console.log(`  WARN: ${w}`));
  }

  if (validResult.validPhotos.length === 0) {
    console.error('\nERROR: All photos failed validation — stopping test.');
    process.exit(1);
  }

  // ── 2. Run PDF generator ───────────────────────────────────────────────────
  console.log('\nStep 2: PDF Generation');
  console.log('─'.repeat(40));
  console.log(`  Order: ${ORDER_PATH}`);
  console.log(`  Python: ${PYTHON}`);

  const generatorPath = path.join(ROOT, 'pdf', 'generator.py');

  execFile(PYTHON, [generatorPath, ORDER_PATH], { timeout: 120000 }, (err, stdout, stderr) => {
    if (stderr) {
      console.log('\n  [Generator logs]:');
      stderr.split('\n').filter(Boolean).forEach(l => console.log('  ' + l));
    }

    if (err) {
      console.error(`\nERROR: Generator failed — ${err.message}`);
      process.exit(1);
    }

    let result;
    try {
      const lines = stdout.trim().split('\n');
      result = JSON.parse(lines[lines.length - 1]);
    } catch {
      console.error('\nERROR: Could not parse generator output:', stdout);
      process.exit(1);
    }

    if (!result.success) {
      console.error(`\nERROR: ${result.error}`);
      process.exit(1);
    }

    console.log(`\n  ✓ PDF saved:     ${result.pdfPath}`);
    console.log(`  ✓ Preview saved: ${result.previewPath}`);

    // Verify files exist
    if (fs.existsSync(result.pdfPath)) {
      const size = (fs.statSync(result.pdfPath).size / 1024).toFixed(1);
      console.log(`  ✓ PDF size: ${size} KB`);
    } else {
      console.error('  ERROR: PDF file not found after generation!');
    }

    console.log('\n=== TEST PASSED ===\n');
  });
}

run().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
