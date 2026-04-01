# Vistec GraphX — Funeral Program Automation System
## Claude Code Build Reference (`claude.md`)

> Generated from planning conversation. Use this as the master reference when running Claude Code.

---

## Project Summary

An internal staff tool that auto-populates pre-designed funeral program templates with customer photos and information, then outputs a print-ready CMYK PDF. Staff fills out a form, the system does the layout work.

**Core flow:**
1. Staff opens `localhost:3000` in browser
2. Fills out form: deceased info, service info, obituary text, photos, format, frame selection
3. System validates photos, processes them, overlays content onto CorelDraw template PDF
4. Staff downloads completed print-ready PDF

---

## Architecture Decision Log

| Decision | Choice | Reason |
|---|---|---|
| Template approach | CorelDraw → CMYK PDF background | Preserves existing designs; CMYK native |
| PDF overlay tool | `pdf-lib` (JS) | Simpler than ReportLab for overlay-based layout |
| Photo processing | Python + Pillow | Resize, CMYK convert, crop, sharpen |
| Color space | CMYK throughout | Press-correct; avoids RIP color shift on skin tones |
| Frame system | SVG frame library (separate from templates) | Frames are interchangeable per order |
| Deployment | Local only (localhost) | Internal staff tool, fully offline after setup |
| Auth | None | Internal use only, Phase 1 |
| Storage | Flat file system | No database needed for Phase 1 |

---

## Directory Structure

```
vistec-funeral-tool/
├── README.md
├── .env.example
├── package.json
├── requirements.txt
├── server.js                    # Express — serves UI + handles form submission
├── public/
│   └── index.html               # Single-page staff intake form
├── src/
│   ├── validator.js             # Photo resolution + file type validation
│   ├── layoutEngine.js          # Assigns zones based on format + content
│   └── formats.js               # All 5 format specs
├── pdf/
│   ├── generator.py             # pdf-lib overlay + ReportLab for text/photo placement
│   └── imageProcessor.py        # Pillow — resize, CMYK convert, sharpen photos
├── templates/
│   ├── letter-bifold.pdf        # CorelDraw export — CMYK, 300 DPI, bleed, NO placeholder content
│   ├── legal-bifold.pdf
│   ├── legal-trifold.pdf
│   ├── 11x17-bifold.pdf
│   └── 11x17-trifold.pdf
├── zones/
│   ├── letter-bifold.json       # Zone coordinates for each template
│   ├── legal-bifold.json
│   ├── legal-trifold.json
│   ├── 11x17-bifold.json
│   └── 11x17-trifold.json
├── frames/
│   ├── oval-classic.svg
│   ├── oval-floral.svg
│   ├── rect-rounded-gold.svg
│   ├── rect-shadow.svg
│   ├── cross-inset.svg
│   ├── vignette-soft.svg
│   ├── ornamental-corners.svg
│   └── none.svg
├── uploads/                     # Temp photo storage per order
├── outputs/                     # Completed PDFs saved here
└── test/
    ├── testOrder.json
    └── runTest.js
```

---

## Format Specifications

All dimensions at 300 DPI. Bleed = 0.125" = 38px per edge (76px total per dimension).

| Format ID | Flat Size | Pixels (no bleed) | Panels |
|---|---|---|---|
| letter-bifold | 8.5" × 11" | 2550 × 3300 | 4 |
| legal-bifold | 8.5" × 14" | 2550 × 4200 | 4 |
| legal-trifold | 8.5" × 14" | 2550 × 4200 | 6 |
| 11x17-bifold | 11" × 17" | 3300 × 5100 | 4 |
| 11x17-trifold | 11" × 17" | 3300 × 5100 | 6 |

> **Note:** Letter size only comes in bi-fold. Disable tri-fold option in UI when Letter is selected.

### Tri-fold Panel Order (Critical)

Rightmost panel when flat = front cover. Panel sequence:

- **Front side (right to left):** Panel 1 (front cover) → Panel 2 (inside center) → Panel 3 (inside left)
- **Back side (right to left):** Panel 4 → Panel 5 → Panel 6

---

## Zone Types

Defined in `formats.js` and each `zones/*.json` file. Coordinates are **percentage-based (0.0–1.0)** relative to each panel for DPI independence.

| Zone Type | Description |
|---|---|
| `PORTRAIT` | Primary large photo — typically front cover panel |
| `GALLERY` | 2–4 smaller photos in grid |
| `TEXT_BODY` | Obituary text block |
| `SERVICE_INFO` | Structured: date, time, location, officiant |
| `HEADER` | Deceased full name + life dates (large display text) |
| `ACCENT` | Decorative line or graphic placeholder |
| `BACKGROUND` | Full-panel background image (muted/low opacity) |

### Default Panel → Zone Assignment

| Panel | Zones |
|---|---|
| Front cover | `PORTRAIT` (full panel) + `HEADER` (bottom overlay) |
| Inside left | `TEXT_BODY` |
| Inside right | `SERVICE_INFO` + `ACCENT` |
| Back cover | `HEADER` (name/dates) + `ACCENT` + `SERVICE_INFO` summary |

---

## Frame System

Frames are **separate from templates** and interchangeable per order.

### Layering Order

```
Layer 3 — Selected frame SVG (from /frames/)
Layer 2 — Customer photo (cropped/sized to zone)
Layer 1 — Template PDF background (CorelDraw export)
```

### Frame File Rules (CorelDraw → SVG export)

- Canvas size must match largest photo zone dimensions
- Center must be **transparent** so photo shows through
- Export each frame as SVG from CorelDraw
- Name clearly for UI display
- Drop new frames into `/frames/` — system picks them up automatically, no code changes

### Initial Frame Set (minimum for launch)

- `oval-classic.svg`
- `oval-floral.svg`
- `rect-rounded-gold.svg`
- `rect-shadow.svg`
- `cross-inset.svg`
- `vignette-soft.svg`
- `ornamental-corners.svg`
- `none.svg` ← always include a no-frame option

---

## Photo Validation Rules (`validator.js`)

1. Accepted types: JPG, JPEG, PNG only
2. Minimum resolution: **1200px on shortest dimension** (ensures 300 DPI at 4" minimum print size)
3. Max file size: 20MB per photo
4. Max count: 10 photos per order
5. Failed photo → **flag with warning, skip it, continue with remaining photos**
6. ALL photos failed → **stop, return clear error to UI**
7. Log per photo: `{ filename, passed, width, height, shortestDimension, reason }`

---

## Photo Processing (`imageProcessor.py`)

1. Open with Pillow
2. Check EXIF DPI — if missing, assume 72 DPI
3. Basic RGB → CMYK conversion via numpy
   - `TODO: Upgrade to ICC profile conversion in Phase 3`
4. Resize to target zone dimensions at 300 DPI
5. Apply unsharp mask: `radius=1.5, percent=150, threshold=3`
6. Return processed image path to generator

---

## PDF Generation (`generator.py`)

Uses `pdf-lib` (JS) for overlay + Pillow for image prep.

1. Load template PDF as fixed background layer
2. Place processed customer photos into photo zones (cover-fill, center crop, maintain aspect ratio)
3. Overlay selected SVG frame on top of each photo zone
4. Place text into text zones:
   - Obituary: auto-size from 11pt down to 8pt minimum; truncate with note if still too long
   - Name, dates, service info: placed at zone coordinates
5. CMYK color space throughout — **no RGB in output**
6. Bleed: all layers extend 0.125" past trim edge
7. Crop marks: 0.25" long, 0.125" gap from trim, 0.5pt stroke, Registration (CMYK 1,1,1,1)
8. Output: `/outputs/{orderId}_print.pdf`
9. Preview: first panel only, RGB, 150 DPI JPEG → `/outputs/{orderId}_preview.jpg`

---

## Staff UI (`public/index.html`)

Plain HTML + vanilla JS. No framework. Single page. Fast to fill out.

### Form Fields

**Deceased Information**
- First Name (required)
- Last Name (required)
- Date of Birth (date picker, required)
- Date of Death (date picker, required)

**Service Information**
- Service Date (date picker, required)
- Service Time (text, required)
- Location (text, required)
- Officiant (text, optional)

**Program Content**
- Obituary Text (large textarea, required)

**Photos**
- Multi-file upload (`.jpg`, `.jpeg`, `.png`)
- Show filename + file size after selection

**Format Selection**
- Size: Letter | Legal | 11×17 (radio)
- Fold: Bi-fold | Tri-fold (radio — disable Tri-fold when Letter selected)

**Frame Selection**
- Thumbnail grid or dropdown showing each frame option
- Always include "No Frame" option

**Theme**
- Style: Classic | Elegant | Modern (radio, default: Classic)
- Font: Serif | Sans (radio, default: Serif)

**Submit:** "Generate Program PDF"

### UI States

| State | Display |
|---|---|
| Processing | "Generating your program..." |
| Success | Download link for PDF + preview image |
| Error | Specific error message in red — never generic "something went wrong" |

---

## Server (`server.js`)

Express server:

| Route | Method | Description |
|---|---|---|
| `/` | GET | Serves `public/index.html` |
| `/generate` | POST | Receives multipart form data → runs pipeline → returns result |
| `/download/:filename` | GET | Serves file from `/outputs/` |
| `/health` | GET | Returns 200 |

### Pipeline Flow in `/generate`

1. Parse form fields + save uploaded photos to `/uploads/{orderId}/`
2. Run `validator.js` on each photo
3. Run `imageProcessor.py` on each validated photo
4. Call `generator.py` via `child_process.execFile` with order JSON
5. Return: `{ success, pdfPath, previewPath, warnings[] }`

---

## Dependencies

### `package.json`

```json
{
  "dependencies": {
    "express": "^4.18.0",
    "multer": "^1.4.5",
    "uuid": "^9.0.0",
    "dotenv": "^16.0.0"
  }
}
```

### `requirements.txt`

```
reportlab==4.0.9
Pillow==10.2.0
numpy==1.26.4
```

---

## `.env.example`

```
PORT=3000
OUTPUT_DIR=./outputs
PYTHON_PATH=python3
ANTHROPIC_API_KEY=your_key_here
LOG_LEVEL=info
MAX_UPLOAD_SIZE_MB=20
```

---

## Test Order (`test/testOrder.json`)

```json
{
  "deceased": {
    "firstName": "Margaret",
    "lastName": "Louise Johnson",
    "dateOfBirth": "1942-03-15",
    "dateOfDeath": "2025-11-28"
  },
  "service": {
    "date": "2025-12-03",
    "time": "2:00 PM",
    "location": "Grace Baptist Church, Charlotte NC",
    "officiant": "Pastor David Williams"
  },
  "format": {
    "size": "letter",
    "fold": "bifold"
  },
  "preferences": {
    "theme": "classic",
    "fontFamily": "serif"
  },
  "photos": [
    { "filename": "test1.jpg", "localPath": "./uploads/test/test1.jpg" },
    { "filename": "test2.jpg", "localPath": "./uploads/test/test2.jpg" },
    { "filename": "test3.jpg", "localPath": "./uploads/test/test3.jpg" }
  ]
}
```

> Drop 2–3 actual JPG files into `/uploads/test/` before running the test — the validator needs real images.

---

## CorelDraw Export Checklist

Before building, complete this for each template:

### Template PDF Export
- [ ] Convert document color mode: Tools → Color Management → Document Settings → **CMYK**
- [ ] Check for color shifts after conversion (skin tones, deep blacks, gradients)
- [ ] Deep black = Rich Black: C60 M40 Y40 K100 (not just K100)
- [ ] Remove all placeholder text and photo boxes from export
- [ ] Keep frame artwork in export — frames stay in template layer
- [ ] Export settings: CMYK, 300 DPI, 0.125" bleed, crop marks included
- [ ] Save to `/templates/{format-id}.pdf`

> **Exception:** Since frames are now in the separate `/frames/` library and interchangeable, remove all frame artwork from the template PDF export as well. Leave photo zones completely blank.

### Zone Coordinate Documentation
- [ ] On a separate copy, measure every fill zone
- [ ] Record: X, Y, Width, Height from **bottom-left corner, in inches**
- [ ] Note zone type for each area
- [ ] Note which zones have frame overlays
- [ ] Transfer measurements to `/zones/{format-id}.json` using percentage-based coordinates (0.0–1.0)

---

## Phase Roadmap

| Phase | Scope | Status |
|---|---|---|
| **Phase 1** | Local staff tool, template overlay, photo placement, text placement, 3 templates | 🔨 Build now |
| **Phase 2** | Frame library UI, 5 formats, all zone types, photo gallery zones | Next |
| **Phase 3** | Claude Vision for photo analysis + zone selection, ICC profile CMYK conversion, custom fonts | Future |
| **Phase 4** | Customer-facing portal, cloud storage (Cloudflare R2), email delivery | Future |

---

## Known Limitations (Phase 1)

- Basic RGB → CMYK conversion (no ICC profile) — color accuracy is good, not press-perfect
- Built-in fonts only (Helvetica, Times-Roman via ReportLab)
- No revision/edit workflow — regenerate if changes needed
- No database — flat file system
- No cloud storage — all files local
- No email/SMS delivery
- Claude Vision not integrated yet (`/ai` folder scaffolded, empty)

---

## Critical Constraints — Never Skip

1. All PDFs must be **CMYK** — never output RGB PDF
2. **Bleed on all 4 edges**, all formats
3. **Crop marks** on all outputs
4. Tri-fold panel order: right panel flat = front cover
5. Photo validation runs **before** PDF generation — always
6. Every error must surface to the UI with a **specific message** — no silent failures
7. No external API calls — runs fully offline

---

## Scaling to 10+ Templates

Adding a new template requires only:

1. Export from CorelDraw → `/templates/{format-id}.pdf`
2. Document zone coordinates → `/zones/{format-id}.json`
3. No code changes needed

Adding a new frame requires only:

1. Design in CorelDraw, export as SVG → `/frames/{frame-name}.svg`
2. No code changes needed — system picks it up automatically
