// Prisma BigInt 無法直接 JSON.stringify，統一轉字串再回傳
export const serialize = (value) =>
  JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
