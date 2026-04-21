import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { KNOWN_HOSTS_FILE } from './config.js';

const SSH_DIR = join(homedir(), '.ssh');
const DEFAULT_KEY_BASENAME = 'id_ed25519';

const makeComment = (suffix = '') => `sam-ui-manager@${hostname()}${suffix ? `-${suffix}` : ''}`;

const shellQuote = (value = '') => `"${String(value).replace(/(["\\])/g, '\\$1')}"`;

// Keep SSH non-interactive and accept new host keys automatically into an app-local file.
// This avoids the common first-connection "Host key verification failed" error while still
// rejecting changed host keys on later connections.
export const gitSshCommand = () => [
  'ssh',
  '-o', 'BatchMode=yes',
  '-o', 'StrictHostKeyChecking=accept-new',
  '-o', `UserKnownHostsFile=${shellQuote(KNOWN_HOSTS_FILE.replace(/\\/g, '/'))}`
].join(' ');

// Public keys are safe to show in UI; private keys are never read or returned.
const parsePublicKey = (line = '') => {
  const trimmed = String(line || '').trim();
  const [type, key, ...commentParts] = trimmed.split(/\s+/);
  if (!type || !key || !/^ssh-|^ecdsa-/i.test(type)) return null;
  return { type, key, comment: commentParts.join(' ') };
};

const keyPreview = (raw = '') => {
  const parsed = parsePublicKey(raw);
  if (!parsed) return null;
  const suffix = parsed.key.length > 24 ? `${parsed.key.slice(0, 12)}...${parsed.key.slice(-12)}` : parsed.key;
  return `${parsed.type} ${suffix}${parsed.comment ? ` ${parsed.comment}` : ''}`;
};

const collectFileKeys = () => {
  if (!existsSync(SSH_DIR)) return [];
  return readdirSync(SSH_DIR)
    .filter((name) => name.endsWith('.pub'))
    .map((name) => {
      try {
        const fullPath = join(SSH_DIR, name);
        const publicKey = readFileSync(fullPath, 'utf8').trim();
        const parsed = parsePublicKey(publicKey);
        if (!parsed) return null;
        return {
          source: 'file',
          name,
          preview: keyPreview(publicKey),
          publicKey
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
};

const collectAgentKeys = async () => {
  try {
    const { stdout } = await execa('ssh-add', ['-L']);
    return String(stdout || '')
      .split(/\r?\n/)
      .map((line, idx) => {
        const publicKey = line.trim();
        if (!publicKey || /no identities/i.test(publicKey)) return null;
        const parsed = parsePublicKey(publicKey);
        if (!parsed) return null;
        return {
          source: 'agent',
          name: `agent-${idx + 1}`,
          preview: keyPreview(publicKey),
          publicKey
        };
      })
      .filter(Boolean);
  } catch {
    // ssh-agent may be disabled; file-backed keys can still work.
    return [];
  }
};

export async function listUsablePublicKeys() {
  const fileKeys = collectFileKeys();
  const agentKeys = await collectAgentKeys();
  const seen = new Set();

  // Deduplicate by full public key text in case same key is both in agent and file.
  return [...fileKeys, ...agentKeys].filter((entry) => {
    if (!entry?.publicKey || seen.has(entry.publicKey)) return false;
    seen.add(entry.publicKey);
    return true;
  });
}

export async function ensurePublicKey() {
  const existing = await listUsablePublicKeys();
  if (existing.length) return { generated: false, keys: existing };

  mkdirSync(SSH_DIR, { recursive: true });
  const keyPath = join(SSH_DIR, DEFAULT_KEY_BASENAME);

  try {
    await execa('ssh-keygen', ['-t', 'ed25519', '-C', makeComment(), '-f', keyPath, '-N', '']);
  } catch (error) {
    throw new Error(`failed to generate SSH key: ${error.shortMessage || error.message}`);
  }

  const keys = await listUsablePublicKeys();
  if (!keys.length) throw new Error('SSH key generation completed but no public key was found');
  return { generated: true, keys };
}

const nextGeneratedKeyPath = () => {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  for (let index = 0; index < 1000; index += 1) {
    const suffix = index ? `_${index}` : '';
    const name = `${DEFAULT_KEY_BASENAME}_samui_${stamp}${suffix}`;
    const full = join(SSH_DIR, name);
    if (!existsSync(full) && !existsSync(`${full}.pub`)) return { name, full };
  }
  throw new Error('unable to allocate a unique SSH key filename');
};

export async function generateNewPublicKey() {
  mkdirSync(SSH_DIR, { recursive: true });
  const { name, full } = nextGeneratedKeyPath();

  try {
    await execa('ssh-keygen', ['-t', 'ed25519', '-C', makeComment(name), '-f', full, '-N', '']);
  } catch (error) {
    throw new Error(`failed to generate new SSH key: ${error.shortMessage || error.message}`);
  }

  const keys = await listUsablePublicKeys();
  const created = keys.find((entry) => entry.source === 'file' && entry.name === `${name}.pub`) || null;
  if (!keys.length) throw new Error('SSH key generation completed but no public key was found');
  return { generated: true, created, keys };
}

export async function deleteFileBackedPublicKey(name = '') {
  const pubName = String(name || '').trim();
  if (!/^[A-Za-z0-9._-]+\.pub$/.test(pubName)) throw new Error('invalid SSH public key name');

  const pubPath = join(SSH_DIR, pubName);
  if (!existsSync(pubPath)) throw new Error('SSH public key file not found');

  const privatePath = join(SSH_DIR, pubName.slice(0, -4));
  unlinkSync(pubPath);
  if (existsSync(privatePath)) unlinkSync(privatePath);

  const keys = await listUsablePublicKeys();
  return { deleted: pubName, keys };
}

