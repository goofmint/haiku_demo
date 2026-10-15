// crypto.getRandomValues works in insecure contexts (e.g. http://192.168.x.x on a tablet),
// unlike crypto.randomUUID which requires a secure context.
export function createId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${Date.now().toString(36)}-${hex}`;
}
