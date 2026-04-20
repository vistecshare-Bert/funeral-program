const fs = require('fs');
const path = require('path');

const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_UPLOAD_SIZE_MB) || 20;
const MIN_SHORT_SIDE_PX = 1;     // accept any resolution
const WARN_SHORT_SIDE_PX = 1200; // warn but still allow — may be slightly soft in print
const ALLOWED_TYPES = ['.jpg', '.jpeg', '.png'];

/**
 * Validates an array of uploaded photo files.
 * Returns { validPhotos, warnings, errors }
 * - validPhotos: files that passed all checks (including low-res with warning)
 * - warnings: quality warnings for low-res photos (still processed)
 * - errors: fatal error strings (used when ALL photos fail)
 */
async function validatePhotos(files) {
  const validPhotos = [];
  const warnings = [];
  const errors = [];

  for (const file of files) {
    const result = await validateSinglePhoto(file);
    if (result.passed) {
      validPhotos.push(file);
      if (result.warning) {
        warnings.push(`Photo "${file.originalname}" accepted with warning: ${result.warning}`);
      }
    } else {
      warnings.push(`Photo "${file.originalname}" skipped: ${result.reason}`);
      errors.push(`"${file.originalname}": ${result.reason}`);
    }
    logPhotoResult(result);
  }

  return { validPhotos, warnings, errors };
}

async function validateSinglePhoto(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  const logEntry = {
    filename: file.originalname,
    passed: false,
    width: null,
    height: null,
    shortestDimension: null,
    reason: null
  };

  // File type check
  if (!ALLOWED_TYPES.includes(ext)) {
    logEntry.reason = `File type not allowed (${ext}). Use JPG or PNG.`;
    return logEntry;
  }

  // File size check
  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    logEntry.reason = `File size exceeds ${MAX_FILE_SIZE_MB}MB limit.`;
    return logEntry;
  }

  // Image dimension check using sharp
  try {
    const metadata = await getImageMetadata(file.path);
    logEntry.width = metadata.width;
    logEntry.height = metadata.height;
    logEntry.shortestDimension = Math.min(metadata.width, metadata.height);

    if (logEntry.shortestDimension < MIN_SHORT_SIDE_PX) {
      logEntry.reason = `Resolution too low: shortest side is ${logEntry.shortestDimension}px (minimum ${MIN_SHORT_SIDE_PX}px). Photo is too small to use.`;
      return logEntry;
    }

    if (logEntry.shortestDimension < WARN_SHORT_SIDE_PX) {
      logEntry.passed = true;
      logEntry.warning = `Low resolution (${logEntry.shortestDimension}px shortest side — recommended 1200px). Photo may appear soft in print.`;
      return logEntry;
    }

    logEntry.passed = true;
    return logEntry;

  } catch (err) {
    logEntry.reason = `Could not read image file: ${err.message}`;
    return logEntry;
  }
}

async function getImageMetadata(filePath) {
  // Try sharp first; fall back to basic file header inspection
  try {
    const sharp = requireSharp();
    if (sharp) {
      const meta = await sharp(filePath).metadata();
      return { width: meta.width, height: meta.height };
    }
  } catch {}

  // Fallback: read PNG/JPEG headers manually
  return readImageDimensionsFromHeader(filePath);
}

function requireSharp() {
  try {
    return require('sharp');
  } catch {
    return null;
  }
}

function readImageDimensionsFromHeader(filePath) {
  return new Promise((resolve, reject) => {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(24);
    fs.readSync(fd, buf, 0, 24, 0);
    fs.closeSync(fd);

    // PNG: signature + IHDR
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      return resolve({ width, height });
    }

    // JPEG: scan for SOF marker
    const data = fs.readFileSync(filePath);
    for (let i = 0; i < data.length - 9; i++) {
      if (data[i] === 0xff && (data[i + 1] === 0xc0 || data[i + 1] === 0xc2)) {
        const height = data.readUInt16BE(i + 5);
        const width = data.readUInt16BE(i + 7);
        return resolve({ width, height });
      }
    }

    reject(new Error('Could not determine image dimensions'));
  });
}

function logPhotoResult(entry) {
  const status = entry.passed ? 'PASS' : 'FAIL';
  const dims = entry.width ? ` [${entry.width}x${entry.height}, short=${entry.shortestDimension}px]` : '';
  const reason = entry.reason ? ` — ${entry.reason}` : '';
  console.log(`[Photo Validation] ${status}: ${entry.filename}${dims}${reason}`);
}

module.exports = { validatePhotos };
