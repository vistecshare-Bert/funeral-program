"""
generator.py — PDF generation pipeline for Vistec Funeral Tool

Pipeline:
1. Load order JSON
2. Load template PDF as background layer
3. Process photos via imageProcessor
4. Overlay SVG frames on photo zones
5. Place text (obituary, header, service info)
6. Add bleed + crop marks
7. Output CMYK PDF to /outputs/{orderId}_print.pdf
8. Output RGB preview JPEG to /outputs/{orderId}_preview.jpg
"""

import sys
import os
import json
import logging
import textwrap
import subprocess
from pathlib import Path

# ReportLab
from reportlab.pdfgen import canvas
from reportlab.lib.units import inch
from reportlab.lib.colors import CMYKColor, black, white
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from PIL import Image

# Local
sys.path.insert(0, os.path.dirname(__file__))
from imageProcessor import process_photo, _rgb_to_cmyk

logging.basicConfig(level=logging.INFO, format='[Generator] %(levelname)s: %(message)s')
log = logging.getLogger(__name__)

DPI = 300
BLEED_IN = 0.125
CROP_MARK_LEN = 0.25
CROP_MARK_GAP = 0.125

# Rich Black for headings: C60 M40 Y40 K100
RICH_BLACK = CMYKColor(0.60, 0.40, 0.40, 1.00)
# Registration color for crop marks
REGISTRATION = CMYKColor(1.0, 1.0, 1.0, 1.0)
# Near-black for body text
TEXT_BLACK = CMYKColor(0.0, 0.0, 0.0, 0.90)
# Dark gray for secondary text
GRAY = CMYKColor(0.0, 0.0, 0.0, 0.60)
# Gold accent
GOLD = CMYKColor(0.0, 0.18, 0.65, 0.20)

SCRIPT_DIR = Path(__file__).parent
ROOT_DIR = SCRIPT_DIR.parent


def load_zone_def(format_id: str) -> dict:
    zone_path = ROOT_DIR / 'zones' / f'{format_id}.json'
    if not zone_path.exists():
        raise FileNotFoundError(f'Zone file not found: {zone_path}')
    return json.loads(zone_path.read_text())


def get_format_spec(size: str, fold: str) -> dict:
    """Return flat dimensions and panel count."""
    specs = {
        'letter-bifold': {'w': 8.5, 'h': 11.0, 'panels': 4, 'cols': 2},
        'legal-bifold':  {'w': 8.5, 'h': 14.0, 'panels': 4, 'cols': 2},
        'legal-trifold': {'w': 8.5, 'h': 14.0, 'panels': 6, 'cols': 3},
        '11x17-bifold':  {'w': 11.0, 'h': 17.0, 'panels': 4, 'cols': 2},
        '11x17-trifold': {'w': 11.0, 'h': 17.0, 'panels': 6, 'cols': 3},
    }
    key = f'{size}-{fold}'
    if key not in specs:
        raise ValueError(f'Unknown format: {key}')
    return specs[key]


def pts(inches: float) -> float:
    """Convert inches to PDF points."""
    return inches * 72.0


def generate(order_path: str) -> dict:
    with open(order_path, encoding='utf-8') as f:
        order = json.load(f)

    order_id = order['orderId']
    size = order['format']['size']
    fold = order['format']['fold']
    format_id = f'{size}-{fold}'
    prefs = order.get('preferences', {})
    frame_name = prefs.get('frame', 'none')
    font_family = prefs.get('fontFamily', 'serif')
    theme = prefs.get('theme', 'classic')

    spec = get_format_spec(size, fold)
    zone_def = load_zone_def(format_id)

    flat_w = spec['w']
    flat_h = spec['h']
    cols = spec['cols']
    panel_w = flat_w / cols
    panel_h = flat_h

    # PDF canvas size includes bleed on all 4 sides
    pdf_w = pts(flat_w + BLEED_IN * 2)
    pdf_h = pts(flat_h + BLEED_IN * 2)
    bleed_pt = pts(BLEED_IN)

    output_dir = ROOT_DIR / 'outputs'
    output_dir.mkdir(exist_ok=True)
    pdf_path = output_dir / f'{order_id}_print.pdf'
    preview_path = output_dir / f'{order_id}_preview.jpg'

    # Check for template PDF
    template_pdf = ROOT_DIR / 'templates' / f'{format_id}.pdf'
    has_template = template_pdf.exists()
    if not has_template:
        log.warning(f'Template PDF not found: {template_pdf}. Generating without background template.')

    # Process portrait photo
    upload_dir = ROOT_DIR / 'uploads' / order_id
    portrait_data = order.get('portrait', {})
    portrait_src = portrait_data.get('localPath', '')
    processed_portrait = None
    if portrait_src and os.path.exists(portrait_src):
        out = str(upload_dir / 'portrait.tif')
        result = process_photo(portrait_src, out, 1500, 2000)
        if result['success']:
            processed_portrait = result['outputPath']
        else:
            log.warning(f'Portrait processing failed: {result["error"]}')
    else:
        log.warning(f'Portrait photo not found: {portrait_src}')

    # Process gallery photos
    gallery_data = order.get('gallery', [])
    processed_gallery = {}  # slot -> path
    for item in gallery_data:
        slot = item.get('slot', 0)
        src = item.get('localPath', '')
        if not src or not os.path.exists(src):
            log.warning(f'Gallery photo not found for slot {slot}: {src}')
            continue
        out = str(upload_dir / f'gallery_{slot}.tif')
        result = process_photo(src, out, 800, 800)
        if result['success']:
            processed_gallery[slot] = result['outputPath']
        else:
            log.warning(f'Gallery photo processing failed slot {slot}: {result["error"]}')

    # Keep legacy support: if old-style photos array sent, use first as portrait
    if not processed_portrait:
        legacy = order.get('photos', [])
        if legacy:
            src = legacy[0].get('localPath', '')
            if src and os.path.exists(src):
                out = str(upload_dir / 'portrait_legacy.tif')
                result = process_photo(src, out, 1500, 2000)
                if result['success']:
                    processed_portrait = result['outputPath']

    # Font selection — map UI font values to ReportLab built-in fonts
    _serif_fonts  = {'serif', 'garamond', 'palatino', 'cursive'}
    title_font = 'Times-Roman' if font_family in _serif_fonts else 'Helvetica'
    body_font  = 'Times-Roman' if font_family in _serif_fonts else 'Helvetica'

    # Build PDF
    c = canvas.Canvas(str(pdf_path), pagesize=(pdf_w, pdf_h))
    c.setTitle(f'{order["deceased"]["firstName"]} {order["deceased"]["lastName"]} — Funeral Program')

    # Coordinate helpers (PDF origin = bottom-left)
    def panel_x(panel_id: int) -> float:
        idx = (panel_id - 1) % cols
        return bleed_pt + pts(idx * panel_w)

    def zone_rect(panel_id: int, zone: dict):
        """Returns (x, y, w, h) in PDF points, bottom-left origin."""
        px = panel_x(panel_id)
        pw = pts(panel_w)
        ph = pts(panel_h)
        zx = px + zone['x'] * pw
        # PDF y=0 is bottom; zone y is from top → invert
        zy_top = bleed_pt + ph - zone['y'] * ph - zone['height'] * ph
        zw = zone['width'] * pw
        zh = zone['height'] * ph
        return (zx, zy_top, zw, zh)

    # Draw template background if available
    if has_template:
        try:
            c.drawImage(str(template_pdf), 0, 0, pdf_w, pdf_h, preserveAspectRatio=False)
        except Exception as e:
            log.warning(f'Could not draw template PDF: {e}')

    gallery_slot_idx = 0

    for panel in zone_def['panels']:
        pid = panel['id']
        for zone in panel['zones']:
            ztype = zone['type']
            x, y, w, h = zone_rect(pid, zone)

            if ztype == 'PORTRAIT':
                photos_list = [processed_portrait] if processed_portrait else []
                _draw_photo_zone(c, x, y, w, h, photos_list, 0, zone, frame_name, theme)

            elif ztype == 'GALLERY':
                # Use the next assigned gallery slot photo
                while gallery_slot_idx < 21 and gallery_slot_idx not in processed_gallery:
                    gallery_slot_idx += 1
                if gallery_slot_idx in processed_gallery:
                    photos_list = [processed_gallery[gallery_slot_idx]]
                    _draw_photo_zone(c, x, y, w, h, photos_list, 0, zone, frame_name, theme)
                    gallery_slot_idx += 1

            elif ztype == 'HEADER':
                _draw_header(c, x, y, w, h, order, title_font, theme)

            elif ztype == 'TEXT_BODY':
                _draw_obituary(c, x, y, w, h, order['obituary'], body_font)

            elif ztype == 'SERVICE_INFO':
                _draw_service_info(c, x, y, w, h, order['service'], order['deceased'], body_font, theme)

            elif ztype == 'ACCENT':
                _draw_accent(c, x, y, w, h, theme)

    # Crop marks
    _draw_crop_marks(c, pdf_w, pdf_h, bleed_pt)

    c.save()
    log.info(f'PDF saved: {pdf_path}')

    # Generate preview (first panel, RGB JPEG)
    _generate_preview(str(pdf_path), str(preview_path), panel_w, panel_h)

    return {
        'success': True,
        'pdfPath': str(pdf_path),
        'previewPath': str(preview_path)
    }


def _draw_photo_zone(c, x, y, w, h, photos, idx, zone, frame_name, theme):
    """Draw photo into zone with optional frame overlay."""
    if not photos or idx >= len(photos):
        # Draw placeholder box
        c.saveState()
        c.setFillColorCMYK(0, 0, 0, 0.08)
        c.rect(x, y, w, h, fill=1, stroke=0)
        c.restoreState()
        return

    photo_path = photos[idx]
    try:
        c.saveState()
        # Clip to zone bounds
        p = c.beginPath()
        p.rect(x, y, w, h)
        c.clipPath(p, stroke=0)
        img_reader = ImageReader(photo_path)
        c.drawImage(img_reader, x, y, w, h, preserveAspectRatio=False, mask='auto')
        c.restoreState()
    except Exception as e:
        log.warning(f'Could not draw photo {photo_path}: {e}')

    # Overlay frame SVG (converted to raster if needed)
    _draw_frame(c, x, y, w, h, frame_name)


def _draw_frame(c, x, y, w, h, frame_name):
    """Draw frame PNG/SVG overlay on top of photo zone."""
    if not frame_name or frame_name == 'none':
        return

    frames_dir = ROOT_DIR / 'frames'
    svg_path = frames_dir / f'{frame_name}.svg'
    png_path = frames_dir / f'{frame_name}_cached.png'

    if not svg_path.exists():
        return

    # Convert SVG to PNG if not cached
    if not png_path.exists():
        try:
            # Use cairosvg if available, else skip
            import cairosvg
            cairosvg.svg2png(
                url=str(svg_path),
                write_to=str(png_path),
                output_width=int(w),
                output_height=int(h)
            )
        except ImportError:
            log.warning('cairosvg not installed — frame overlays skipped. Install: pip install cairosvg')
            return
        except Exception as e:
            log.warning(f'Frame SVG conversion failed: {e}')
            return

    try:
        img_reader = ImageReader(str(png_path))
        c.drawImage(img_reader, x, y, w, h, preserveAspectRatio=False, mask='auto')
    except Exception as e:
        log.warning(f'Frame overlay draw failed: {e}')


def _draw_header(c, x, y, w, h, order, font, theme):
    """Draw deceased name and life dates in header zone."""
    dec = order['deceased']
    name = f'{dec["firstName"]} {dec["lastName"]}'
    dob = _fmt_date(dec.get('dateOfBirth', ''))
    dod = _fmt_date(dec.get('dateOfDeath', ''))
    dates = f'{dob} — {dod}'

    c.saveState()

    # Background band (semi-transparent dark)
    c.setFillColorCMYK(0.60, 0.40, 0.40, 0.85)
    c.rect(x, y, w, h, fill=1, stroke=0)

    # Name
    name_size = _fit_font_size(c, name, font, w * 0.9, h * 0.55, 28, 14)
    c.setFillColor(white)
    c.setFont(font, name_size)
    c.drawCentredString(x + w / 2, y + h * 0.52, name)

    # Dates
    date_size = max(name_size - 4, 10)
    c.setFont(font, date_size)
    c.setFillColorCMYK(0, 0, 0.10, 0.10)
    c.drawCentredString(x + w / 2, y + h * 0.20, dates)

    c.restoreState()


def _draw_obituary(c, x, y, w, h, text, font):
    """Auto-size and flow obituary text in zone."""
    if not text:
        return

    c.saveState()
    c.setFillColor(TEXT_BLACK)

    # Try font sizes from 11 down to 8
    final_size = 8
    for size in range(11, 7, -1):
        lines = _wrap_text(text, font, size, w - 12)
        total_h = len(lines) * (size * 1.4)
        if total_h <= h - 12:
            final_size = size
            break

    c.setFont(font, final_size)
    line_h = final_size * 1.4
    lines = _wrap_text(text, font, final_size, w - 12)

    cur_y = y + h - 6 - final_size
    for line in lines:
        if cur_y < y + 4:
            # Truncate — note to staff
            c.setFont(font, 7)
            c.setFillColor(GRAY)
            c.drawString(x + 6, y + 4, '[Obituary continued — please verify full text fits]')
            break
        c.setFont(font, final_size)
        c.setFillColor(TEXT_BLACK)
        c.drawString(x + 6, cur_y, line)
        cur_y -= line_h

    c.restoreState()


def _draw_service_info(c, x, y, w, h, service, deceased, font, theme):
    """Draw structured service information block."""
    c.saveState()

    title_size = 13
    label_size = 9
    value_size = 11

    cur_y = y + h - 10

    # Section title
    c.setFont(font + '-Bold' if font == 'Helvetica' else font, title_size)
    c.setFillColor(RICH_BLACK)
    title = 'Celebration of Life' if theme == 'modern' else 'Order of Service'
    c.drawCentredString(x + w / 2, cur_y, title)
    cur_y -= title_size * 1.8

    # Divider
    c.setStrokeColor(GOLD)
    c.setLineWidth(0.75)
    c.line(x + w * 0.1, cur_y + 4, x + w * 0.9, cur_y + 4)
    cur_y -= 10

    fields = [
        ('Date', _fmt_date(service.get('date', ''))),
        ('Time', service.get('time', '')),
        ('Location', service.get('location', '')),
    ]
    if service.get('officiant'):
        fields.append(('Officiant', service['officiant']))

    for label, value in fields:
        if not value:
            continue
        c.setFont(font, label_size)
        c.setFillColor(GRAY)
        c.drawString(x + 8, cur_y, label.upper())
        cur_y -= label_size * 1.3

        c.setFont(font, value_size)
        c.setFillColor(TEXT_BLACK)
        # Wrap long values
        wrapped = _wrap_text(value, font, value_size, w - 16)
        for line in wrapped:
            c.drawString(x + 8, cur_y, line)
            cur_y -= value_size * 1.4

        cur_y -= 6

    c.restoreState()


def _draw_accent(c, x, y, w, h, theme=None):
    """Draw decorative accent line."""
    c.saveState()
    mid_y = y + h / 2

    c.setStrokeColor(GOLD)
    c.setLineWidth(1.0)
    c.line(x, mid_y, x + w, mid_y)

    # Small ornament at center
    c.setFillColor(GOLD)
    c.circle(x + w / 2, mid_y, 3, fill=1, stroke=0)
    c.circle(x + w / 4, mid_y, 1.5, fill=1, stroke=0)
    c.circle(x + 3 * w / 4, mid_y, 1.5, fill=1, stroke=0)

    c.restoreState()


def _draw_crop_marks(c, pdf_w, pdf_h, bleed_pt):
    """Draw crop marks at all 4 corners."""
    c.saveState()
    c.setStrokeColor(REGISTRATION)
    c.setLineWidth(0.5)

    gap = pts(CROP_MARK_GAP)
    length = pts(CROP_MARK_LEN)

    corners = [
        (bleed_pt, bleed_pt),               # bottom-left
        (pdf_w - bleed_pt, bleed_pt),        # bottom-right
        (bleed_pt, pdf_h - bleed_pt),        # top-left
        (pdf_w - bleed_pt, pdf_h - bleed_pt) # top-right
    ]

    for cx, cy in corners:
        # Horizontal marks
        if cx < pdf_w / 2:  # left side
            c.line(cx - gap - length, cy, cx - gap, cy)
        else:               # right side
            c.line(cx + gap, cy, cx + gap + length, cy)

        # Vertical marks
        if cy < pdf_h / 2:  # bottom
            c.line(cx, cy - gap - length, cx, cy - gap)
        else:               # top
            c.line(cx, cy + gap, cx, cy + gap + length)

    c.restoreState()


def _generate_preview(pdf_path: str, preview_path: str, panel_w_in: float, panel_h_in: float):
    """Generate a 150 DPI RGB JPEG preview of the first panel."""
    try:
        # Use pdf2image if available
        from pdf2image import convert_from_path
        pages = convert_from_path(pdf_path, dpi=150, first_page=1, last_page=1)
        if pages:
            img = pages[0]
            # Crop to first panel width
            panel_px = int(panel_w_in * 150)
            bleed_px = int(BLEED_IN * 150)
            img_w, img_h = img.size
            # Crop: skip bleed on left, take one panel width
            left = bleed_px
            right = left + panel_px
            img = img.crop((left, 0, min(right, img_w), img_h))
            img = img.convert('RGB')
            img.save(preview_path, 'JPEG', quality=85, dpi=(150, 150))
            log.info(f'Preview saved: {preview_path}')
    except ImportError:
        log.warning('pdf2image not installed — preview generation skipped. Install: pip install pdf2image')
    except Exception as e:
        log.warning(f'Preview generation failed: {e}')
        # Create a simple placeholder preview
        try:
            img = Image.new('RGB', (int(panel_w_in * 150), int(panel_h_in * 150)), color=(240, 240, 240))
            img.save(preview_path, 'JPEG', quality=85)
        except Exception:
            pass


def _fit_font_size(c, text, font, max_w, max_h, max_size, min_size):
    """Find largest font size where text fits within bounds."""
    for size in range(max_size, min_size - 1, -1):
        try:
            c.setFont(font, size)
            tw = c.stringWidth(text, font, size)
            if tw <= max_w and size <= max_h:
                return size
        except Exception:
            pass
    return min_size


def _wrap_text(text, font, size, max_width):
    """Wrap text to fit within max_width. Returns list of lines."""
    from reportlab.pdfgen.canvas import Canvas as _C
    from reportlab.lib.utils import simpleSplit
    try:
        return simpleSplit(text, font, size, max_width)
    except Exception:
        # Fallback
        words = text.split()
        lines = []
        current = ''
        for word in words:
            test = (current + ' ' + word).strip()
            if len(test) * size * 0.5 < max_width:
                current = test
            else:
                if current:
                    lines.append(current)
                current = word
        if current:
            lines.append(current)
        return lines


def _fmt_date(date_str: str) -> str:
    """Format YYYY-MM-DD to Month DD, YYYY."""
    try:
        from datetime import datetime
        dt = datetime.strptime(date_str, '%Y-%m-%d')
        return dt.strftime('%B %d, %Y')
    except Exception:
        return date_str


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'Usage: generator.py <order.json>'}))
        sys.exit(1)

    try:
        result = generate(sys.argv[1])
        print(json.dumps(result))
    except Exception as e:
        log.exception('Fatal generator error')
        print(json.dumps({'success': False, 'error': str(e)}))
        sys.exit(1)
