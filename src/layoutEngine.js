const path = require('path');
const fs = require('fs');
const { getFormat } = require('./formats');

/**
 * Resolves the zone layout for a given order.
 * Returns an array of absolute zone positions (in points/inches)
 * ready for the PDF generator.
 *
 * Coordinate system: percentage-based (0.0–1.0) per panel → converted to absolute PDF points.
 * PDF points: 1 point = 1/72 inch. All zones returned in points.
 */
function resolveLayout(order) {
  const { size, fold } = order.format;
  const format = getFormat(size, fold);
  const zoneFile = path.join(__dirname, '..', 'zones', `${format.id}.json`);

  if (!fs.existsSync(zoneFile)) {
    throw new Error(`Zone definition not found for format: ${format.id}. Expected at: ${zoneFile}`);
  }

  const zoneDef = JSON.parse(fs.readFileSync(zoneFile, 'utf-8'));

  // Panel dimensions in points (PDF unit)
  const flatWidthPt = format.flatWidthIn * 72;
  const flatHeightPt = format.flatHeightIn * 72;
  const panelWidthPt = flatWidthPt / (format.panels / 2);  // divide by panels per side
  const panelHeightPt = flatHeightPt;
  const bleedPt = (format.bleedPx / format.dpi) * 72;  // bleed in points

  const resolvedZones = [];

  for (const panel of zoneDef.panels) {
    const panelIndex = panel.id - 1;
    const panelOffsetX = (panelIndex % (format.panels / 2)) * panelWidthPt;
    const panelOffsetY = 0;

    for (const zone of panel.zones) {
      resolvedZones.push({
        panelId: panel.id,
        panelName: panel.name,
        type: zone.type,
        hasFrame: zone.hasFrame || false,
        // Absolute coords in points (with bleed offset)
        x: bleedPt + panelOffsetX + zone.x * panelWidthPt,
        y: bleedPt + panelOffsetY + zone.y * panelHeightPt,
        width: zone.width * panelWidthPt,
        height: zone.height * panelHeightPt,
        // Percentage-based for reference
        relX: zone.x,
        relY: zone.y,
        relWidth: zone.width,
        relHeight: zone.height
      });
    }
  }

  return {
    format,
    flatWidthPt,
    flatHeightPt,
    panelWidthPt,
    panelHeightPt,
    bleedPt,
    zones: resolvedZones
  };
}

/**
 * Assigns photos to photo zones (PORTRAIT, GALLERY, BACKGROUND).
 * Returns a mapping of { zoneType+panelId -> photo }.
 */
function assignPhotosToZones(zones, photos) {
  const photoZones = zones.filter(z => ['PORTRAIT', 'GALLERY', 'BACKGROUND'].includes(z.type));
  const assignments = {};
  let photoIndex = 0;

  // PORTRAIT gets the first (best) photo
  const portraitZones = photoZones.filter(z => z.type === 'PORTRAIT');
  for (const zone of portraitZones) {
    if (photoIndex < photos.length) {
      assignments[`${zone.type}_${zone.panelId}`] = photos[photoIndex++];
    }
  }

  // GALLERY gets next photos
  const galleryZones = photoZones.filter(z => z.type === 'GALLERY');
  for (const zone of galleryZones) {
    if (photoIndex < photos.length) {
      assignments[`${zone.type}_${zone.panelId}`] = photos[photoIndex++];
    }
  }

  // BACKGROUND gets any remaining (optional, use first photo at low opacity if available)
  const bgZones = photoZones.filter(z => z.type === 'BACKGROUND');
  for (const zone of bgZones) {
    assignments[`${zone.type}_${zone.panelId}`] = photos[0]; // always use first photo for bg
  }

  return assignments;
}

module.exports = { resolveLayout, assignPhotosToZones };
