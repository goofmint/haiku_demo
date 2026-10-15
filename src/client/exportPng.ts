import type { WhiteboardObject } from '../shared/model.ts';
import { objectBounds, unionBounds } from './geometry.ts';
import { drawObjects, measureText } from './render.ts';

const PADDING = 24;
const EXPORT_SCALE = 2;

/**
 * Renders all objects into a white PNG cropped to their bounding box and starts a download.
 * Returns false when there is nothing to export.
 */
export function downloadPng(objects: WhiteboardObject[]): boolean {
  const bounds = unionBounds(objects.map((object) => objectBounds(object, measureText)));
  if (!bounds) return false;

  const width = Math.ceil(bounds.maxX - bounds.minX + PADDING * 2);
  const height = Math.ceil(bounds.maxY - bounds.minY + PADDING * 2);

  const canvas = document.createElement('canvas');
  canvas.width = width * EXPORT_SCALE;
  canvas.height = height * EXPORT_SCALE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas is not supported in this browser');

  context.scale(EXPORT_SCALE, EXPORT_SCALE);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.translate(PADDING - bounds.minX, PADDING - bounds.minY);
  drawObjects(context, objects);

  canvas.toBlob((blob) => {
    if (!blob) throw new Error('Failed to encode the PNG');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `whiteboard-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    link.click();
    // Give the browser time to start the download before releasing the object URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
  return true;
}
