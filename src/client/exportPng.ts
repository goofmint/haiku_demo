import type { BoardObject } from '../shared/types';
import {
  EXPORT_BACKGROUND,
  EXPORT_MAX_SIDE,
  EXPORT_PADDING,
  EXPORT_PREFERRED_SCALE,
} from './drawStyle';
import type { MeasureText } from './geometry';
import { exportBounds, exportScale, objectBounds } from './geometry';
import { drawObject } from './render';

const FILE_PREFIX = 'whiteboard-';
const FILE_EXTENSION = '.png';
const PNG_MIME = 'image/png';
/** ダウンロード開始前に URL を破棄しないよう、少し待ってから revoke する */
const REVOKE_DELAY_MS = 1000;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** whiteboard-YYYYMMDD-HHmmss.png(ローカル時刻) */
export function exportFileName(date: Date): string {
  const ymd = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
  const hms = `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
  return `${FILE_PREFIX}${ymd}-${hms}${FILE_EXTENSION}`;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to encode PNG'));
    }, PNG_MIME);
  });
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/** ボード全体を白背景の PNG としてダウンロードする。オブジェクトが無ければ 'empty' */
export async function exportBoardPng(
  objects: BoardObject[],
  measure: MeasureText,
): Promise<'ok' | 'empty'> {
  const bounds = exportBounds(
    objects.map((o) => objectBounds(o, measure)),
    EXPORT_PADDING,
  );
  if (!bounds) return 'empty';

  const scale = exportScale(bounds, EXPORT_PREFERRED_SCALE, EXPORT_MAX_SIDE);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((bounds.maxX - bounds.minX) * scale);
  canvas.height = Math.ceil((bounds.maxY - bounds.minY) * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context is not available');

  ctx.fillStyle = EXPORT_BACKGROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, -bounds.minX * scale, -bounds.minY * scale);
  for (const obj of objects) drawObject(ctx, obj, measure);

  const blob = await canvasToBlob(canvas);
  downloadBlob(blob, exportFileName(new Date()));
  return 'ok';
}
