/**
 * Format specifications for all 5 program templates.
 * All pixel dimensions at 300 DPI. Bleed = 0.125" = 38px per edge.
 */

const BLEED_PX = 38; // 0.125" at 300 DPI

const FORMATS = {
  'letter-bifold': {
    id: 'letter-bifold',
    label: 'Letter Bi-fold (8.5" × 11")',
    flatWidthIn: 8.5,
    flatHeightIn: 11,
    widthPx: 2550,
    heightPx: 3300,
    panels: 4,
    foldType: 'bifold',
    allowedFolds: ['bifold'],
    dpi: 300,
    bleedPx: BLEED_PX,
    widthPxWithBleed: 2550 + BLEED_PX * 2,
    heightPxWithBleed: 3300 + BLEED_PX * 2,
    panelWidthPx: 1275,   // half of flat width
    panelHeightPx: 3300
  },
  'legal-bifold': {
    id: 'legal-bifold',
    label: 'Legal Bi-fold (8.5" × 14")',
    flatWidthIn: 8.5,
    flatHeightIn: 14,
    widthPx: 2550,
    heightPx: 4200,
    panels: 4,
    foldType: 'bifold',
    allowedFolds: ['bifold', 'trifold'],
    dpi: 300,
    bleedPx: BLEED_PX,
    widthPxWithBleed: 2550 + BLEED_PX * 2,
    heightPxWithBleed: 4200 + BLEED_PX * 2,
    panelWidthPx: 1275,
    panelHeightPx: 4200
  },
  'legal-trifold': {
    id: 'legal-trifold',
    label: 'Legal Tri-fold (8.5" × 14")',
    flatWidthIn: 8.5,
    flatHeightIn: 14,
    widthPx: 2550,
    heightPx: 4200,
    panels: 6,
    foldType: 'trifold',
    allowedFolds: ['trifold'],
    dpi: 300,
    bleedPx: BLEED_PX,
    widthPxWithBleed: 2550 + BLEED_PX * 2,
    heightPxWithBleed: 4200 + BLEED_PX * 2,
    panelWidthPx: 850,   // one-third of flat width
    panelHeightPx: 4200
  },
  '11x17-bifold': {
    id: '11x17-bifold',
    label: '11×17 Bi-fold',
    flatWidthIn: 11,
    flatHeightIn: 17,
    widthPx: 3300,
    heightPx: 5100,
    panels: 4,
    foldType: 'bifold',
    allowedFolds: ['bifold', 'trifold'],
    dpi: 300,
    bleedPx: BLEED_PX,
    widthPxWithBleed: 3300 + BLEED_PX * 2,
    heightPxWithBleed: 5100 + BLEED_PX * 2,
    panelWidthPx: 1650,
    panelHeightPx: 5100
  },
  '11x17-trifold': {
    id: '11x17-trifold',
    label: '11×17 Tri-fold',
    flatWidthIn: 11,
    flatHeightIn: 17,
    widthPx: 3300,
    heightPx: 5100,
    panels: 6,
    foldType: 'trifold',
    allowedFolds: ['trifold'],
    dpi: 300,
    bleedPx: BLEED_PX,
    widthPxWithBleed: 3300 + BLEED_PX * 2,
    heightPxWithBleed: 5100 + BLEED_PX * 2,
    panelWidthPx: 1100,   // one-third of flat width
    panelHeightPx: 5100
  }
};

/**
 * Returns the format spec for a given size + fold combination.
 * size: 'letter' | 'legal' | '11x17'
 * fold: 'bifold' | 'trifold'
 */
function getFormat(size, fold) {
  const key = `${size}-${fold}`;
  const fmt = FORMATS[key];
  if (!fmt) throw new Error(`Unknown format: ${key}. Valid options: ${Object.keys(FORMATS).join(', ')}`);
  return fmt;
}

/**
 * Returns all available formats.
 */
function getAllFormats() {
  return Object.values(FORMATS);
}

module.exports = { FORMATS, getFormat, getAllFormats, BLEED_PX };
