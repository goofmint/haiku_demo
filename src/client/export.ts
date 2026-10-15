const OBJECT_URL_REVOKE_DELAY_MS = 1000;

export function downloadPng(canvas: HTMLCanvasElement, filename: string): void {
  const tmp = document.createElement('canvas');
  tmp.width = canvas.width;
  tmp.height = canvas.height;
  const ctx = tmp.getContext('2d');
  if (ctx === null) throw new Error('Canvas 2D context is not available');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, tmp.width, tmp.height);
  ctx.drawImage(canvas, 0, 0);

  tmp.toBlob((blob) => {
    if (blob === null) throw new Error('PNG export failed: toBlob returned null');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_REVOKE_DELAY_MS);
  }, 'image/png');
}
