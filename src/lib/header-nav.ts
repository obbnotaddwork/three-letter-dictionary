/**
 * ヘッダー「トップ / タグ / トレーニング」のどれを現在地として強調するか。
 * base 付きパス（GitHub Pages）でも先頭セグメントを除いて判定する。
 */
export type HeaderNavTab = 'top' | 'tags' | 'training';

export function activeHeaderNav(
  pathname: string,
  baseUrl: string,
): HeaderNavTab | null {
  const baseSegs = (baseUrl || '/').split('/').filter(Boolean);
  const parts = pathname.split('/').filter(Boolean);

  let offset = 0;
  if (
    baseSegs.length > 0 &&
    parts.length >= baseSegs.length &&
    baseSegs.every((s, i) => parts[i] === s)
  ) {
    offset = baseSegs.length;
  }

  const rest = parts.slice(offset);
  if (rest.length === 0) return 'top';
  if (rest[0] === 'tags') return 'tags';
  if (rest[0] === 'training') return 'training';
  return null;
}
