require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const { validatePhotos } = require('./src/validator');

const app = express();
const PORT = process.env.PORT || 3000;
const OUTPUT_DIR = process.env.OUTPUT_DIR || './outputs';
const PYTHON_PATH = process.env.PYTHON_PATH || 'python3';

app.use(express.json());
app.use(express.static('public'));
app.use('/frames', express.static(path.join(__dirname, 'frames')));
app.use('/template-thumbs', express.static(path.join(__dirname, 'template-thumbs')));

// Multer — save uploads per orderId
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const orderId = req.orderId || (req.orderId = uuidv4());
    const dir = path.join('uploads', orderId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: (parseInt(process.env.MAX_UPLOAD_SIZE_MB) || 20) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.jpg', '.jpeg', '.png'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.originalname}. Use JPG or PNG only.`));
    }
  }
});

// ── Template metadata helpers ────────────────────────────────────────
const TEMPLATES_META = path.join(__dirname, 'templates', 'metadata.json');

function readMeta() {
  try { return JSON.parse(fs.readFileSync(TEMPLATES_META, 'utf8')); }
  catch { return []; }
}
function writeMeta(data) {
  fs.writeFileSync(TEMPLATES_META, JSON.stringify(data, null, 2));
}

// ── Multer for template uploads ──────────────────────────────────────
const templateStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dest = file.mimetype === 'application/pdf'
      ? path.join(__dirname, 'templates')
      : path.join(__dirname, 'template-thumbs');
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  }
});
const templateUpload = multer({
  storage: templateStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.pdf', '.jpg', '.jpeg', '.png'].includes(ext)) cb(null, true);
    else cb(new Error(`Only PDF and image files allowed.`));
  }
});

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ── Template routes ──────────────────────────────────────────────────
app.get('/templates', (req, res) => {
  res.json(readMeta());
});

app.post('/admin/upload-template', templateUpload.fields([
  { name: 'templatePdf', maxCount: 1 },
  { name: 'thumbnail',   maxCount: 1 }
]), (req, res) => {
  try {
    const pdfFile   = (req.files['templatePdf'] || [])[0];
    const thumbFile = (req.files['thumbnail']   || [])[0];

    if (!pdfFile) return res.status(400).json({ success: false, error: 'PDF file is required.' });

    const { name, format } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ success: false, error: 'Template name is required.' });
    if (!format)               return res.status(400).json({ success: false, error: 'Format is required.' });

    const meta = readMeta();
    const entry = {
      id:          uuidv4(),
      name:        name.trim(),
      filename:    pdfFile.filename,
      format,
      thumbnail:   thumbFile ? `/template-thumbs/${thumbFile.filename}` : null,
      uploadedAt:  new Date().toISOString().split('T')[0]
    };
    meta.push(entry);
    writeMeta(meta);

    res.json({ success: true, template: entry });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/admin/templates/:id', (req, res) => {
  try {
    const meta    = readMeta();
    const idx     = meta.findIndex(t => t.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, error: 'Template not found.' });

    const entry = meta[idx];
    // Delete PDF
    const pdfPath = path.join(__dirname, 'templates', entry.filename);
    if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
    // Delete thumbnail
    if (entry.thumbnail) {
      const thumbPath = path.join(__dirname, entry.thumbnail.replace(/^\//, ''));
      if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
    }

    meta.splice(idx, 1);
    writeMeta(meta);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/frames', (req, res) => {
  const framesDir = path.join(__dirname, 'frames');
  try {
    const files = fs.readdirSync(framesDir)
      .filter(f => f.endsWith('.svg'))
      .map(f => ({ filename: f, name: f.replace('.svg', '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) }));
    res.json(files);
  } catch {
    res.json([]);
  }
});

app.post('/generate', (req, res, next) => {
  req.orderId = uuidv4();
  next();
}, upload.fields([
  { name: 'portrait', maxCount: 1 },
  ...Array.from({length: 21}, (_, i) => ({ name: `gallery_${i}`, maxCount: 1 }))
]), async (req, res) => {
  const orderId = req.orderId;

  try {
    // Parse form fields
    const {
      firstName, lastName, dateOfBirth, dateOfDeath,
      serviceDate, serviceTime, serviceLocation, officiant,
      obituary, size, fold, frame, theme, fontFamily, templateId
    } = req.body;

    // Required field check
    const missing = [];
    if (!firstName) missing.push('First Name');
    if (!lastName) missing.push('Last Name');
    if (!dateOfBirth) missing.push('Date of Birth');
    if (!dateOfDeath) missing.push('Date of Death');
    if (!serviceDate) missing.push('Service Date');
    if (!serviceTime) missing.push('Service Time');
    if (!serviceLocation) missing.push('Service Location');
    if (!obituary) missing.push('Obituary');
    if (!size) missing.push('Format Size');
    if (!fold) missing.push('Fold Type');

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Missing required fields: ${missing.join(', ')}`
      });
    }

    // Letter size can only be bifold
    if (size === 'letter' && fold === 'trifold') {
      return res.status(400).json({
        success: false,
        error: 'Letter size is only available as bi-fold. Please select a different size for tri-fold.'
      });
    }

    // Collect portrait + gallery files
    const files = req.files || {};
    const portraitFiles = files['portrait'] || [];
    if (portraitFiles.length === 0) {
      return res.status(400).json({ success: false, error: 'A portrait photo is required.' });
    }

    const galleryFiles = [];
    for (let i = 0; i < 21; i++) {
      const f = (files[`gallery_${i}`] || [])[0];
      if (f) galleryFiles.push({ slot: i, file: f });
    }

    // Validate all photos
    const allFiles = [...portraitFiles, ...galleryFiles.map(g => g.file)];
    const validationResult = await validatePhotos(allFiles);
    const warnings = validationResult.warnings;

    const validSet = new Set(validationResult.validPhotos.map(f => f.path));
    if (!validSet.has(portraitFiles[0].path)) {
      return res.status(400).json({ success: false, error: 'Portrait photo failed validation. ' + validationResult.errors[0] });
    }

    // Build order object
    const order = {
      orderId,
      deceased: { firstName, lastName, dateOfBirth, dateOfDeath },
      service: { date: serviceDate, time: serviceTime, location: serviceLocation, officiant: officiant || '' },
      obituary,
      format: { size, fold },
      preferences: { theme: theme || 'classic', fontFamily: fontFamily || 'serif', frame: frame || 'none' },
      templateId: templateId || null,
      portrait: { filename: portraitFiles[0].filename, localPath: portraitFiles[0].path },
      gallery: galleryFiles
        .filter(g => validSet.has(g.file.path))
        .map(g => ({ slot: g.slot, filename: g.file.filename, localPath: g.file.path }))
    };

    // Write order JSON for Python
    const orderPath = path.join('uploads', orderId, 'order.json');
    fs.writeFileSync(orderPath, JSON.stringify(order, null, 2));

    // Run Python generator
    const pythonScript = path.join(__dirname, 'pdf', 'generator.py');
    execFile(PYTHON_PATH, [pythonScript, orderPath], { timeout: 120000 }, (err, stdout, stderr) => {
      if (err) {
        console.error('Generator error:', stderr || err.message);
        return res.status(500).json({
          success: false,
          error: `PDF generation failed: ${stderr || err.message}`
        });
      }

      let result;
      try {
        // Generator outputs JSON on last line
        const lines = stdout.trim().split('\n');
        result = JSON.parse(lines[lines.length - 1]);
      } catch {
        return res.status(500).json({
          success: false,
          error: 'PDF generator returned unexpected output. Check server logs.'
        });
      }

      if (!result.success) {
        return res.status(500).json({ success: false, error: result.error });
      }

      res.json({
        success: true,
        pdfPath: `/download/${path.basename(result.pdfPath)}`,
        previewPath: `/download/${path.basename(result.previewPath)}`,
        warnings
      });
    });

  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ success: false, error: `Server error: ${err.message}` });
  }
});

app.get('/download/:filename', (req, res) => {
  const filePath = path.join(__dirname, OUTPUT_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found.' });
  }
  res.download(filePath);
});

// Error handler for multer
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ success: false, error: `File too large. Maximum is ${process.env.MAX_UPLOAD_SIZE_MB || 20}MB per photo.` });
  }
  res.status(400).json({ success: false, error: err.message });
});

app.listen(PORT, () => {
  console.log(`Vistec Funeral Tool running at http://localhost:${PORT}`);
  // Ensure output dir exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
});
