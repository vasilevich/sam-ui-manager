import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { KEY_FILE } from './config.js';

// Read local symmetric key created at startup. If this file is lost,
// previously stored secrets cannot be decrypted.
const key = () => Buffer.from(readFileSync(KEY_FILE, 'utf8').trim(), 'hex');

export const encrypt = (plain = '') => {
  if (!String(plain).trim()) return '';

  // AES-256-GCM payload format: v1:<iv>:<authTag>:<ciphertext>
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join(':');
};

export const decrypt = (payload = '') => {
  if (!payload) return '';
  const [v, iv, tag, body] = String(payload).split(':');
  if (v !== 'v1') throw new Error('bad secret format');

  // Authentication tag verification happens during `decipher.final()`.
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8');
};
