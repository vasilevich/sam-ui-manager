import { byId, state } from './store.js';
import { $, esc, fmtDate, statusClass } from './helpers.js';

export function renderStats() {
  const items = [['Projects', state.apps.length], ['Online', state.apps.filter((a) => a.status === 'online').length], ['Stopped', state.apps.filter((a) => a.status === 'stopped').length], ['With last error', state.apps.filter((a) => a.lastError).length]];
  $('stats').innerHTML = items.map(([k, v]) => `<div class="stat"><div class="muted">${k}</div><div style="font-size:26px;margin-top:6px;">${v}</div></div>`).join('');
}

export function renderProjects() {
  $('projects').innerHTML = state.apps.length ? state.apps.map((app) => {
    const draft = state.attachmentDrafts[app.id] || {};
    const bindHost = String(draft.bindHost || '0.0.0.0');
    const bindPort = String(draft.bindPort || '');
    const interfaces = Array.from(new Set(['0.0.0.0', ...(state.meta?.bindInterfaces || [])]));
    const selectHtml = `<select id="bindHost-${app.id}" onchange="sam.setAttachmentDraft('${app.id}','bindHost',this.value)">${interfaces.map((item) => `<option value="${esc(item)}" ${item === bindHost ? 'selected' : ''}>${esc(item)}</option>`).join('')}</select>`;
    const remoteHtml = `<div class="remote-box">${(app.remoteUrls || []).length ? app.remoteUrls.map((item) => `<div class="remote-row"><a href="${esc(item.url)}" target="_blank">${esc(item.url)}</a><button onclick="sam.removeAttachment('${app.id}','${item.id}')">Delete</button></div>`).join('') : '<div class="muted">No remote attachments.</div>'}<div class="remote-row">${selectHtml}<input id="bindPort-${app.id}" placeholder="8080" type="number" min="1" max="65535" value="${esc(bindPort)}" oninput="sam.setAttachmentDraft('${app.id}','bindPort',this.value)" /><button class="primary" onclick="sam.addAttachment('${app.id}')">Attach</button></div></div>`;
    return `
    <div class="project-card">
      <div class="project-head">
        <div><div class="project-name">${esc(app.name)}</div><div class="project-sub">${esc(app.repoHint || app.repoUrl)}</div></div>
        <div class="badges"><div class="badge ${statusClass(app.status)}">${esc(app.status)}</div><div class="badge">${esc(app.authLabel)}</div></div>
      </div>
      <div class="project-grid">
        ${[['Repository URL', app.repoUrl], ['Branch', app.branch], ['Subdirectory', app.subdir || '.'], ['Port', app.port], ['Local URL', app.url ? `<a href="${esc(app.url)}" target="_blank">${esc(app.url)}</a>` : '—'], ['Remote URLs', remoteHtml], ['PM2 / PID', `${app.status} / ${app.pid || '—'}`], ['Last deploy', fmtDate(app.lastDeployAt)], ['Stored secret', app.hasSecret ? 'masked and stored locally' : 'none'], ['Last deploy result', app.lastDeploySummary || '—']].map(([k, v]) => `<div class="kv"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('')}
      </div>
      <div class="actions">
        <button class="primary" onclick="sam.deploy('${app.id}')">Deploy</button>
        <button onclick="sam.start('${app.id}')">Start</button>
        <button onclick="sam.stop('${app.id}')">Stop</button>
        <button onclick="sam.restart('${app.id}')">Restart</button>
        <button onclick="sam.edit('${app.id}')">Edit</button>
        <button onclick="sam.logs('${app.id}')">Logs</button>
        <a href="${esc(app.url || '#')}" target="_blank"><button>Open</button></a>
        <button class="danger" onclick="sam.remove('${app.id}')">Delete</button>
      </div>
      ${app.lastError ? `<div class="error-box">${esc(app.lastError)}</div>` : ''}
    </div>
  `;
  }).join('') : '<div class="panel muted">No projects yet.</div>';
}

export function renderLogs(app, logs) {
  $('logTitle').textContent = `Logs: ${app?.name || ''}`;
  $('deployLog').textContent = logs.deploy || '(no deploy output yet)';
  $('pm2OutLog').textContent = logs.pm2Out || '(no PM2 stdout yet)';
  $('pm2ErrLog').textContent = logs.pm2Err || '(no PM2 stderr yet)';
  $('lastErrorLog').textContent = logs.lastError || '(no stored error)';
  $('logPanel').classList.add('show');
}

export const closeLogs = () => $('logPanel').classList.remove('show');
export const currentApp = () => byId(state.editingId);
