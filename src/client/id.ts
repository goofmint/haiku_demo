/** UUID v4 のバイト数 */
const UUID_BYTES = 16;
/** 16進表記でハイフンを入れる位置(バイト単位) */
const UUID_HYPHEN_AFTER_BYTES: ReadonlySet<number> = new Set([4, 6, 8, 10]);

/**
 * UUID v4 形式の ID を生成する。
 * crypto.randomUUID() は安全なコンテキスト(HTTPS・localhost)でしか使えず、
 * LAN 内の端末から http://<IP>:<port> で開くと例外になるため、
 * どのコンテキストでも使える crypto.getRandomValues() で組み立てる。
 */
export function createId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(UUID_BYTES));
  // RFC 4122: バージョン 4 とバリアント 10xx を設定する
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  let out = '';
  bytes.forEach((b, i) => {
    if (UUID_HYPHEN_AFTER_BYTES.has(i)) out += '-';
    out += b.toString(16).padStart(2, '0');
  });
  return out;
}
