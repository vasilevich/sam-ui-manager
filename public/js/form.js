import { api } from './api.js';
import { state, byId } from './store.js';
import { $, showBanner } from './helpers.js';
import { renderProjects, renderStats } from './render.js';

const authText = {
  public: ['Use a public HTTPS clone URL.', 'Use the plain HTTPS clone URL only. Do not put secrets inside the URL.'],
  https_credentials: ['Use an HTTPS clone URL plus username and password/token.', 'Use the plain HTTPS clone URL only. Do not put secrets inside the URL.'],
  https_token: ['Use an HTTPS clone URL plus token. Username is optional.', 'Use the plain HTTPS clone URL only. Do not put secrets inside the URL.'],
  ssh: ['Use an SSH clone URL. The server uses the machine\'s SSH keys or ssh-agent and auto-trusts new Git hosts on first connect.', 'Use an SSH clone URL like git@github.com:org/repo.git, gitea@git.example.com:org/repo.git, or ssh://user@host/org/repo.git']
};

let lastSshKeys = [];

const show = (id, display = 'block') => { $(id).style.display = display; };
const hide = (id) => { $(id).style.display = 'none'; };

export function syncAuthFields() {
  const method = $('authMethod').value;
  $('authHelper').textContent = authText[method][0];
  $('repoUrlHelper').textContent = authText[method][1];
  if (['https_credentials', 'https_token'].includes(method)) {
    show('authUsernameWrap');
    show('secretWrap');
  } else {
    hide('authUsernameWrap');
    hide('secretWrap');
  }
  if (method === 'ssh') show('sshWrap');
  else hide('sshWrap');
  if (method !== 'ssh') {
    lastSshKeys = [];
    $('sshKeysOutput').textContent = '';
    $('copyFirstSshKeyBtn').disabled = true;
    return;
  }
  if (!$('sshKeysOutput').textContent.trim()) showSshKeys();
}

export function resetForm() {
  state.editingId = null;
  $('projectForm').reset();
  $('branch').value = 'main';
  $('subdir').value = '.';
  $('authMethod').value = 'public';
  $('formTitle').textContent = 'Add project';
  $('saveBtn').textContent = 'Add Project';
  hide('cancelEditBtn');
  $('secretState').textContent = '';
  lastSshKeys = [];
  $('copyFirstSshKeyBtn').disabled = true;
  if (state.meta?.suggestedPort) $('port').value = state.meta.suggestedPort;
  syncAuthFields();
}

export function editProject(id) {
  const app = byId(id); if (!app) return;
  state.editingId = id;
  ['name', 'repoUrl', 'branch', 'subdir', 'port', 'authMethod', 'authUsername'].forEach((k) => { $(k).value = app[k] || (k === 'subdir' ? '.' : ''); });
  $('secret').value = '';
  $('formTitle').textContent = `Edit project: ${app.name}`;
  $('saveBtn').textContent = 'Save Changes';
  show('cancelEditBtn', 'inline-block');
  $('secretState').textContent = app.hasSecret ? 'A secret is already stored. Leave this blank to keep it, or enter a new one to replace it.' : 'No secret stored yet.';
  syncAuthFields();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

export async function pickPort() {
  try { $('port').value = (await api('/api/ports/suggest')).port || ''; showBanner(`Picked port ${$('port').value}.`); }
  catch (e) { showBanner(e.message, 'bad'); }
}

const setSshButtonsDisabled = (disabled) => {
  $('checkSshKeysBtn').disabled = disabled;
  $('generateSshKeyBtn').disabled = disabled;
};

const formatSshKeys = (keys = []) => {
  if (!keys.length) return 'No usable public SSH keys found yet.';
  return keys.map((entry, idx) => `#${idx + 1} (${entry.source}) ${entry.name}\n${entry.publicKey}`).join('\n\n');
};

const renderSshKeys = (keys = []) => {
  lastSshKeys = Array.isArray(keys) ? keys : [];
  show('sshWrap');
  $('sshKeysOutput').textContent = formatSshKeys(lastSshKeys);
  $('copyFirstSshKeyBtn').disabled = !lastSshKeys.length;
  $('sshKeysOutput').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
};

export async function showSshKeys() {
  setSshButtonsDisabled(true);
  try {
    const res = await api('/api/ssh/keys');
    if (!res.hasKeys && res.canGenerate) {
      const created = await api('/api/ssh/keys', { method: 'POST' });
      renderSshKeys(created.keys || []);
      showBanner(created.generated ? 'No SSH key existed, so one was generated automatically. Copy a public key below and add it to your Git provider.' : 'A usable SSH public key already exists.', 'good');
      return;
    }
    renderSshKeys(res.keys || []);
    showBanner(res.hasKeys ? 'Loaded available SSH public keys.' : 'No SSH key found yet.', res.hasKeys ? 'good' : 'warn');
  } catch (e) {
    showBanner(e.message, 'bad');
  } finally {
    setSshButtonsDisabled(false);
  }
}

export async function ensureSshKey() {
  setSshButtonsDisabled(true);
  try {
    const res = await api('/api/ssh/keys', { method: 'POST' });
    renderSshKeys(res.keys || []);
    showBanner(res.generated ? 'Generated a new SSH key. Copy one of the public keys and add it to your Git provider.' : 'A usable SSH public key already exists.', 'good');
  } catch (e) {
    showBanner(e.message, 'bad');
  } finally {
    setSshButtonsDisabled(false);
  }
}

export async function copyFirstSshKey() {
  if (!lastSshKeys.length || !lastSshKeys[0]?.publicKey) {
    showBanner('No public SSH key loaded yet. Click "Show Available Public Keys" first.', 'warn');
    return;
  }
  const key = lastSshKeys[0].publicKey;
  try {
    await navigator.clipboard.writeText(key);
    showBanner('Copied the first public SSH key to clipboard.', 'good');
  } catch {
    // Fallback for browsers/environments where Clipboard API is unavailable.
    const area = document.createElement('textarea');
    area.value = key;
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    document.body.removeChild(area);
    showBanner('Copied the first public SSH key to clipboard.', 'good');
  }
}

export async function submitForm(refresh) {
  const body = Object.fromEntries(new FormData($('projectForm')).entries());
  try {
    const res = state.editingId ? await api(`/api/apps/${state.editingId}`, { method: 'PATCH', body: JSON.stringify(body) }) : await api('/api/apps', { method: 'POST', body: JSON.stringify(body) });
    await refresh();
    if (!state.editingId) resetForm();
    renderStats(); renderProjects();
    showBanner(res.restartRequired ? 'Saved. Restart or deploy to apply runtime changes.' : state.editingId ? 'Project saved.' : 'Project added.', res.restartRequired ? 'warn' : 'good');
  } catch (e) { showBanner(e.message, 'bad'); }
}
