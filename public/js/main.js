import { api } from './api.js';
import { state } from './store.js';
import { $, showBanner } from './helpers.js';
import { closeLogs, renderProjects, renderStats } from './render.js';
import { copySelectedSshKey, deleteSelectedSshKey, editProject, ensureSshKey, generateNewSshKey, pickPort, resetForm, showSshKeys, submitForm, syncAuthFields, syncSelectedSshKeyUi } from './form.js';
import * as actions from './actions.js';

async function refresh(silent = true) {
  try {
    state.meta = await api('/api/meta');
    state.apps = (await api('/api/apps')).apps || [];
    const portInput = $('port');
    if (!state.editingId && !portInput.value) portInput.value = state.meta.suggestedPort || '';
    renderStats();
    renderProjects();
    if (!silent) showBanner('Refreshed.');
  } catch (e) { showBanner(e.message, 'bad'); }
}

window.sam = {
  edit: editProject,
  deploy: (id) => actions.deploy(id, refresh),
  start: (id) => actions.start(id, refresh),
  restart: (id) => actions.restart(id, refresh),
  stop: (id) => actions.stop(id, refresh),
  addAttachment: (id) => actions.addAttachment(id, refresh),
  removeAttachment: (id, attachmentId) => actions.removeAttachment(id, attachmentId, refresh),
  setAttachmentDraft: (id, key, value) => {
    state.attachmentDrafts[id] = { ...(state.attachmentDrafts[id] || {}), [key]: value };
  },
  remove: (id) => actions.remove(id, refresh),
  logs: actions.logs
};

$('projectForm').addEventListener('submit', (e) => { e.preventDefault(); submitForm(refresh); });
$('authMethod').addEventListener('change', syncAuthFields);
$('suggestPortBtn').addEventListener('click', pickPort);
$('checkSshKeysBtn').addEventListener('click', showSshKeys);
$('generateSshKeyBtn').addEventListener('click', ensureSshKey);
$('generateNewSshKeyBtn').addEventListener('click', generateNewSshKey);
$('sshKeyName').addEventListener('change', syncSelectedSshKeyUi);
$('copySelectedSshKeyBtn').addEventListener('click', copySelectedSshKey);
$('deleteSelectedSshKeyBtn').addEventListener('click', deleteSelectedSshKey);
$('cancelEditBtn').addEventListener('click', resetForm);
$('refreshBtn').addEventListener('click', () => refresh(false));
$('closeLogsBtn').addEventListener('click', closeLogs);

syncAuthFields();
await refresh(true);
resetForm();
setInterval(() => {
  const active = document.activeElement?.id || '';
  if (/^bind(Host|Port)-/.test(active)) return;
  refresh(true);
}, 5000);
