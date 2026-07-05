// AES-256-GCM 對稱加密：Onshape token 落地前加密，DB 外洩也拿不到可用 token
import crypto from 'node:crypto';
import { env } from '../config/env.js';

// 金鑰：優先用 ONSHAPE_TOKEN_KEY，否則由 JWT_REFRESH_SECRET 衍生（sha256 → 32 bytes）
const KEY = crypto
  .createHash('sha256')
  .update(env.ONSHAPE_TOKEN_KEY ?? env.JWT_REFRESH_SECRET)
  .digest();

export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // 格式：iv.tag.ciphertext（base64url）
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
}

export function decrypt(boxed) {
  const [iv, tag, data] = boxed.split('.').map((p) => Buffer.from(p, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
