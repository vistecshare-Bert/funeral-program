# Vistec GraphX — Funeral Program Generator

Internal staff tool for auto-populating funeral program templates with customer photos and information, outputting a print-ready CMYK PDF.

## Quick Start

### 1. Install Node dependencies
```bash
npm install
```

### 2. Install Python dependencies
```bash
pip install -r requirements.txt
```

Optional (for frame overlays):
```bash
pip install cairosvg
```

Optional (for PDF preview generation):
```bash
pip install pdf2image
# Also requires poppler: https://github.com/oschwartz10612/poppler-windows/releases
```

### 3. Configure environment
```bash
cp .env.example .env
# Edit .env if needed (defaults work for local use)
```

### 4. Start the server
```bash
npm start
```

Open `http://localhost:3000` in your browser.

---

## Adding Templates

Export from CorelDraw → `/templates/{format-id}.pdf`
Format IDs: `letter-bifold`, `legal-bifold`, `legal-trifold`, `11x17-bifold`, `11x17-trifold`

See `CLAUDE.md` for full CorelDraw export checklist.

## Adding Frames

Drop new SVG files into `/frames/` — the system picks them up automatically.

## Running the Test

Drop test photos into `/uploads/test/` (test1.jpg, test2.jpg, test3.jpg), then:
```bash
node test/runTest.js
```

---

## Output Files

- Print PDF: `/outputs/{orderId}_print.pdf` — CMYK, 300 DPI, with bleed and crop marks
- Preview JPEG: `/outputs/{orderId}_preview.jpg` — RGB, 150 DPI, first panel only
