// 解析 Onshape 文件連結
// 例：https://cad.onshape.com/documents/{did}/w/{wid}/e/{eid}
//     https://cad.onshape.com/documents/{did}/v/{vid}/e/{eid}（版本）
// did/wvmId/eid 皆為 24 碼 hex；wvm ∈ w(workspace)/v(version)/m(microversion)
const RE =
  /\/documents\/([0-9a-f]{24})\/(w|v|m)\/([0-9a-f]{24})(?:\/e\/([0-9a-f]{24}))?/i;

/** @returns {{did:string,wvm:string,wvmId:string,eid:string|null}|null} */
export function parseOnshapeUrl(url) {
  if (typeof url !== 'string') return null;
  const m = url.match(RE);
  if (!m) return null;
  return { did: m[1], wvm: m[2].toLowerCase(), wvmId: m[3], eid: m[4] ?? null };
}

export const isOnshapeUrl = (url) => parseOnshapeUrl(url) !== null;
