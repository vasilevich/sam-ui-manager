import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { HOST, REPO_DIR } from './config.js';
import { decrypt, encrypt } from './secure.js';

// Supported repository authentication modes exposed in the UI.
export const AUTH = ['public', 'https_credentials', 'https_token', 'ssh'];
export const authLabel = (m) => ({ public: 'Public', https_credentials: 'HTTPS username + password/token', https_token: 'HTTPS token', ssh: 'SSH keys' }[m] || m);
export const repoHint = (url = '') => String(url).replace(/\.git$/, '').split(':').pop().split('/').filter(Boolean).slice(-2).join('/');
export const pm2Name = (id) => `samui-${id}`;
export const repoDir = (app) => join(REPO_DIR, app.id);
export const workDir = (app) => join(repoDir(app), cleanSubdir(app.subdir));

// Support both ssh:// URLs and scp-style Git remotes like user@host:org/repo.git.
const isSshRepoUrl = (url = '') => /^ssh:\/\//i.test(url) || /^[^@\s]+@[^:\s]+:.+/.test(url);
const cleanHost = (value = '') => String(value || '').trim().toLowerCase();
const cleanEnvFileName = (value = '.env') => {
  const name = String(value || '.env').trim() || '.env';
  if (name.includes('/') || name.includes('\\') || name.includes('..')) throw new Error('invalid env filename');
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new Error('invalid env filename');
  return name;
};

export function normalizeAttachment(item = {}, index = 0) {
  return {
    id: String(item.id || `ra-${nanoid(6)}-${index}`).trim(),
    bindHost: cleanHost(item.bindHost || '0.0.0.0') || '0.0.0.0',
    bindPort: Number(item.bindPort || 0) || null
  };
}

export const remoteUrlOf = (attachment) => `http://${attachment.bindHost}:${attachment.bindPort}`;

// Normalize user-provided subdirectory into a safe relative path.
// This intentionally rejects ".." segments to block path traversal outside repoDir.
export function cleanSubdir(value = '.') {
  const clean = ('/' + String(value || '.')).replace(/\\/g, '/').replace(/\/+/g, '/');
  const out = clean.split('/').filter(Boolean).reduce((acc, part) => {
    if (part === '..') throw new Error('bad subdirectory');
    if (part !== '.') acc.push(part);
    return acc;
  }, []).join('/');
  return out || '.';
}

// Canonical app shape persisted in DB.
// Missing fields are filled with safe defaults to keep older records compatible.
export function normalizeApp(app = {}) {
  return {
    id: app.id || `app-${nanoid(6)}`,
    name: String(app.name || '').trim() || 'Unnamed project',
    repoUrl: String(app.repoUrl || '').trim(),
    branch: String(app.branch || 'main').trim() || 'main',
    subdir: cleanSubdir(app.subdir || '.'),
    port: Number(app.port || 0) || null,
    authMethod: AUTH.includes(app.authMethod) ? app.authMethod : 'public',
    authUsername: String(app.authUsername || '').trim(),
    sshKeyName: String(app.sshKeyName || '').trim(),
    secretEnc: String(app.secretEnc || ''),
    envEnc: String(app.envEnc || ''),
    runtimeEnvFileName: cleanEnvFileName(app.runtimeEnvFileName || '.env'),
    remoteAttachments: Array.isArray(app.remoteAttachments) ? app.remoteAttachments.map(normalizeAttachment).filter((item) => item.bindPort) : [],
    createdAt: app.createdAt || new Date().toISOString(),
    updatedAt: app.updatedAt || new Date().toISOString(),
    lastDeployAt: app.lastDeployAt || null,
    lastDeploySummary: app.lastDeploySummary || null,
    lastError: app.lastError || null
  };
}

export function validateInput(body, current = null) {
  // Merge inputs into canonical shape first, then apply business rules.
  const next = normalizeApp({ ...current, ...body, secretEnc: current?.secretEnc || '' });
  const username = String((body.authUsername ?? current?.authUsername) || '').trim();
  const secretInput = String(body.secret || '').trim();
  const envTextProvided = Object.prototype.hasOwnProperty.call(body || {}, 'envText');
  const envFileProvided = Object.prototype.hasOwnProperty.call(body || {}, 'envFileName');
  const envText = String(body.envText || '').replace(/\r\n/g, '\n');

  // Repository URL and auth mode must match each other to avoid silent auth confusion.
  if (!next.repoUrl) throw new Error('missing repository URL');
  if (!AUTH.includes(next.authMethod)) throw new Error('invalid authentication method');
  if (/^https?:\/\/[^/\s@]+@/i.test(next.repoUrl)) throw new Error('put credentials in auth fields, not in the repository URL');
  if (next.authMethod === 'ssh' && !isSshRepoUrl(next.repoUrl)) throw new Error('SSH mode expects an SSH clone URL like user@host:org/repo.git or ssh://user@host/org/repo.git');
  if (next.authMethod !== 'ssh' && !/^https:\/\//i.test(next.repoUrl)) throw new Error('use an HTTPS clone URL for this auth mode');
  if (next.authMethod === 'ssh' && next.sshKeyName && !(/^(file:)?[A-Za-z0-9._-]+\.pub$/.test(next.sshKeyName) || /^agent:[A-Za-z0-9._-]+$/.test(next.sshKeyName))) throw new Error('invalid SSH key selection');
  if (next.authMethod === 'https_credentials' && !username) throw new Error('username is required');
  if (!['public', 'ssh'].includes(next.authMethod) && !secretInput && !current?.secretEnc) throw new Error('token or password is required');
  next.authUsername = username;
  next.sshKeyName = next.authMethod === 'ssh' ? String(next.sshKeyName || '').trim() : '';

  // Store encrypted secret only for HTTPS credential/token modes.
  next.secretEnc = ['public', 'ssh'].includes(next.authMethod) ? '' : secretInput ? encrypt(secretInput) : (current?.secretEnc || '');

  // Optional per-project .env text, encrypted at rest and materialized into repo root on deploy/start.
  next.runtimeEnvFileName = envFileProvided ? cleanEnvFileName(body.envFileName) : cleanEnvFileName(current?.runtimeEnvFileName || '.env');
  if (envTextProvided) {
    if (!envText.trim()) next.envEnc = '';
    else {
      const prev = current?.envEnc ? decrypt(current.envEnc) : '';
      next.envEnc = prev === envText ? (current?.envEnc || encrypt(envText)) : encrypt(envText);
    }
  } else next.envEnc = current?.envEnc || '';

  next.updatedAt = new Date().toISOString();
  return next;
}

// Projection returned to clients. Sensitive material is never included in API responses.
export const publicApp = (app, proc = null) => ({
  ...app,
  hasSecret: Boolean(app.secretEnc),
  hasEnvFile: Boolean(app.envEnc),
  envFileName: app.runtimeEnvFileName || '.env',
  authLabel: authLabel(app.authMethod),
  sshKeyLabel: app.authMethod === 'ssh'
    ? (!app.sshKeyName
      ? 'System default / ssh-agent (not pinned)'
      : app.sshKeyName.startsWith('agent:')
        ? `${app.sshKeyName.slice('agent:'.length)} (ssh-agent)`
        : app.sshKeyName.replace(/^file:/, ''))
    : null,
  repoHint: repoHint(app.repoUrl),
  status: proc?.pm2_env?.status || 'stopped',
  pid: proc?.pid || null,
  url: app.port ? `http://${HOST}:${app.port}` : null,
  remoteUrls: (app.remoteAttachments || []).map((attachment) => ({ id: attachment.id, bindHost: attachment.bindHost, bindPort: Number(attachment.bindPort), url: remoteUrlOf(attachment) })),
  repoDisplay: app.repoUrl,
  secretEnc: undefined
});
