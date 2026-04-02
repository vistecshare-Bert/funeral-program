"""
imageProcessor.py — Photo processing pipeline for Vistec Funeral Tool

Steps:
1. Open with Pillow
2. Check EXIF DPI (assume 72 if missing)
3. RGB → CMYK conversion via numpy
4. Resize to target zone dimensions at 300 DPI
5. Apply unsharp mask
6. Save processed image to output path
"""

import sys
import os
import json
import logging
from PIL import Image, ImageFilter
import numpy as np

logging.basicConfig(level=logging.INFO, format='[ImageProcessor] %(levelname)s: %(message)s')
log = logging.getLogger(__name__)


def process_photo(input_path: str, output_path: str, target_width_px: int, target_height_px: int) -> dict:
    """
    Process a single photo for PDF insertion.
    Returns dict with { success, outputPath, error }
    """
    try:
        log.info(f"Processing: {input_path} → {output_path} ({target_width_px}x{target_height_px}px)")

        img = Image.open(input_path)

        # Check EXIF DPI
        dpi = _get_dpi(img)
        log.info(f"  Source DPI: {dpi[0]}x{dpi[1]}")

        # Convert to RGB first (handles palette, RGBA, etc.)
        if img.mode not in ('RGB', 'CMYK'):
            img = img.convert('RGB')

        # Crop to fill target aspect ratio (cover-fill, center crop)
        img = _cover_crop(img, target_width_px, target_height_px)

        # RGB → CMYK
        img = _rgb_to_cmyk(img)

        # Apply unsharp mask (after resize for efficiency)
        img_rgb = img.convert('RGB')  # PIL unsharp mask works on RGB
        img_rgb = img_rgb.filter(ImageFilter.UnsharpMask(radius=1.5, percent=150, threshold=3))
        img = img_rgb.convert('CMYK')

        # Ensure output directory exists
        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        # Save as TIFF (lossless, CMYK-safe) for PDF embedding
        out_file = output_path.rsplit('.', 1)[0] + '.tif'
        img.save(out_file, format='TIFF', dpi=(300, 300), compression='lzw')

        log.info(f"  Saved: {out_file}")
        return {'success': True, 'outputPath': out_file, 'error': None}

    except Exception as e:
        log.error(f"  Failed: {e}")
        return {'success': False, 'outputPath': None, 'error': str(e)}


def _get_dpi(img: Image.Image) -> tuple:
    """Extract DPI from EXIF or return default 72."""
    try:
        exif_data = img._getexif()
        if exif_data:
            # Tag 282 = XResolution, 283 = YResolution
            x_res = exif_data.get(282)
            y_res = exif_data.get(283)
            if x_res and y_res:
                x = float(x_res[0]) / float(x_res[1]) if isinstance(x_res, tuple) else float(x_res)
                y = float(y_res[0]) / float(y_res[1]) if isinstance(y_res, tuple) else float(y_res)
                if x > 0 and y > 0:
                    return (x, y)
    except Exception:
        pass
    return (72, 72)


def _cover_crop(img: Image.Image, target_w: int, target_h: int) -> Image.Image:
    """
    Resize + center-crop to exactly fill target dimensions (cover fill).
    Maintains aspect ratio; no empty bands.
    """
    src_w, src_h = img.size
    src_ratio = src_w / src_h
    tgt_ratio = target_w / target_h

    if src_ratio > tgt_ratio:
        # Source is wider — fit height, crop width
        new_h = target_h
        new_w = int(src_w * (target_h / src_h))
    else:
        # Source is taller — fit width, crop height
        new_w = target_w
        new_h = int(src_h * (target_w / src_w))

    img = img.resize((new_w, new_h), Image.LANCZOS)

    # Center crop
    left = (new_w - target_w) // 2
    top = (new_h - target_h) // 2
    img = img.crop((left, top, left + target_w, top + target_h))

    return img


def _rgb_to_cmyk(img: Image.Image) -> Image.Image:
    """
    Basic RGB → CMYK conversion via numpy.
    TODO Phase 3: upgrade to ICC profile conversion for press-accurate output.
    """
    if img.mode == 'CMYK':
        return img

    rgb = np.array(img.convert('RGB'), dtype=np.float32) / 255.0

    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]

    k = 1.0 - np.max(rgb, axis=2)
    denom = 1.0 - k
    # Avoid divide by zero in full-black areas
    safe_denom = np.where(denom == 0, 1.0, denom)

    c = (1.0 - r - k) / safe_denom
    m = (1.0 - g - k) / safe_denom
    y = (1.0 - b - k) / safe_denom

    # Clamp
    c = np.clip(c, 0, 1)
    m = np.clip(m, 0, 1)
    y = np.clip(y, 0, 1)
    k = np.clip(k, 0, 1)

    cmyk = np.stack([c, m, y, k], axis=2)
    cmyk_uint8 = (cmyk * 255).astype(np.uint8)

    return Image.fromarray(cmyk_uint8, mode='CMYK')


def batch_process(jobs: list) -> list:
    """
    Process a list of jobs: [{ inputPath, outputPath, targetWidthPx, targetHeightPx }]
    Returns list of results.
    """
    results = []
    for job in jobs:
        result = process_photo(
            job['inputPath'],
            job['outputPath'],
            job['targetWidthPx'],
            job['targetHeightPx']
        )
        result['inputPath'] = job['inputPath']
        results.append(result)
    return results


if __name__ == '__main__':
    # Called directly with a JSON jobs file
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'Usage: imageProcessor.py <jobs.json>'}))
        sys.exit(1)

    with open(sys.argv[1]) as f:
        jobs = json.load(f)

    results = batch_process(jobs)
    print(json.dumps(results))
