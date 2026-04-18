import { api } from './api.js';
import { byId, state } from './store.js';
import { showBanner } from './helpers.js';
import { renderLogs } from './render.js';
import { resetForm } from './form.js';

const run = async (label, fn, refresh) => {
  try { showBanner(`${label}...`, 'warn'); await fn(); await refresh(); showBanner(`${label} done.`); return true; }
  catch (e) { showBanner(e.message, 'bad'); return false; }
};

export const deploy = (id, refresh) => run('Deploying', () => api(`/api/apps/${id}/deploy`, { method: 'POST' }), refresh);
export const start = (id, refresh) => run('Starting', () => api(`/api/apps/${id}/start`, { method: 'POST' }), refresh);
export const restart = (id, refresh) => run('Restarting', () => api(`/api/apps/${id}/restart`, { method: 'POST' }), refresh);
export const stop = (id, refresh) => run('Stopping', () => api(`/api/apps/${id}/stop`, { method: 'POST' }), refresh);
export async function addAttachment(id, refresh) {
  const draft = state.attachmentDrafts[id] || {};
  const hostInput = document.getElementById(`bindHost-${id}`);
  const portInput = document.getElementById(`bindPort-${id}`);
  const bindHost = String(draft.bindHost || hostInput?.value || '').trim() || '0.0.0.0';
  const bindPort = Number(String(draft.bindPort || portInput?.value || '').trim());
  if (!bindPort) return showBanner('Enter a bind port first.', 'warn');
  const ok = await run('Attaching remote URL', () => api(`/api/apps/${id}/attachments`, {
    method: 'POST',
    body: JSON.stringify({ bindHost, bindPort })
  }), refresh);
  if (ok) delete state.attachmentDrafts[id];
}

export async function removeAttachment(id, attachmentId, refresh) {
  await run('Deleting attachment', () => api(`/api/apps/${id}/attachments/${attachmentId}`, { method: 'DELETE' }), refresh);
}

export async function remove(id, refresh) {
  const app = byId(id); if (!app || !confirm(`Delete ${app.name}? The repo folder stays on disk.`)) return;
  await run('Deleting', () => api(`/api/apps/${id}`, { method: 'DELETE' }), refresh);
  if (state.editingId === id) resetForm();
}
export async function logs(id) { const app = byId(id); renderLogs(app, await api(`/api/apps/${id}/logs`)); }
