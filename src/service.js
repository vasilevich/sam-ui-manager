import net from 'node:net';
import { nanoid } from 'nanoid';
import getPort, { portNumbers } from 'get-port';
import { HOST, PORT_RANGE } from './config.js';
import { getApps, saveApps } from './db.js';
import { pm2Name, publicApp, validateInput } from './model.js';
import { processMap, restartProcess, startProcess, stopProcess, waitOnline } from './pm2.js';
import { deployLog, pm2ErrLog, pm2OutLog, resetLog, tail } from './logs.js';
import { syncRepo } from './git.js';
import { runSamBuild } from './sam.js';
import { ensureAttachmentProxy, stopAppProxies, stopAttachmentProxy, syncAppProxies } from './proxy.js';
import { resolveGitSshConfig } from './ssh.js';

// Per-app in-memory lock map. Prevents overlapping deploy/start/stop operations
// for the same project, which could corrupt state or produce confusing logs.
const locks = new Map();
const HOST_RE = /^[a-z0-9.-]+$/i;

// Probe if a port can be bound on the configured host.
const isFree = (port) => new Promise((resolve) => {
  const s = net.createServer();
  s.once('error', () => resolve(false));
  s.once('listening', () => s.close(() => resolve(true)));
  s.listen(port, HOST);
});

// Simple mutex-like guard per project id.
const withLock = async (id, fn) => { if (locks.has(id)) throw new Error('this project is already busy'); locks.set(id, true); try { return await fn(); } finally { locks.delete(id); } };

// Validate caller-supplied port, reject duplicate assignments, then verify OS-level availability.
const ensurePort = async (port, apps, currentId = null) => {
  const n = Number(port);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error('bad port');
  const taken = apps.find((app) => app.id !== currentId && Number(app.port) === n);
  if (taken) throw new Error(`port ${n} is already assigned to ${taken.name}`);
  if (!(await isFree(n))) throw new Error(`port ${n} is already in use on ${HOST}`);
  return n;
};

const isSocketFree = (host, port) => new Promise((resolve) => {
  const s = net.createServer();
  s.once('error', () => resolve(false));
  s.once('listening', () => s.close(() => resolve(true)));
  s.listen(Number(port), host);
});

const normalizeBindHost = (value = '') => String(value || '').trim().toLowerCase() || '0.0.0.0';
const normalizeBindPort = (value) => Number(value || 0);
const isValidBindHost = (host) => host === 'localhost' || host === '0.0.0.0' || HOST_RE.test(host) || net.isIP(host) !== 0;
const isOnline = (map, app) => map[pm2Name(app.id)]?.pm2_env?.status === 'online';

const ensureAttachmentInput = (body = {}) => {
  const bindHost = normalizeBindHost(body.bindHost);
  const bindPort = normalizeBindPort(body.bindPort);
  if (!isValidBindHost(bindHost)) throw new Error('invalid bind host');
  if (!Number.isInteger(bindPort) || bindPort < 1 || bindPort > 65535) throw new Error('invalid bind port');
  return { bindHost, bindPort };
};

const checkAttachmentConflict = (apps, appId, candidate) => {
  const occupied = apps.find((app) => (app.remoteAttachments || []).some((item) => item.bindHost === candidate.bindHost && Number(item.bindPort) === Number(candidate.bindPort) && !(app.id === appId && item.id === candidate.id)));
  if (occupied) throw new Error(`bind ${candidate.bindHost}:${candidate.bindPort} is already attached to ${occupied.name}`);
};

const syncBindingsForOnlineApps = async (apps, map = null) => {
  const liveMap = map || await processMap();
  await Promise.all(apps.map(async (app) => {
    try {
      if (isOnline(liveMap, app)) await syncAppProxies(app);
      else await stopAppProxies(app.id);
    } catch {
      // Keep /apps API responsive even if one proxy bind fails.
    }
  }));
};

// Public view returned to API consumers: app metadata + live process status.
const sanitize = async (app) => publicApp(app, (await processMap())[pm2Name(app.id)]);

export const suggestPort = async (apps = getApps()) => getPort({ host: HOST, port: portNumbers(...PORT_RANGE), exclude: apps.map((a) => a.port).filter(Boolean) });
export const listApps = async () => {
  const apps = getApps();
  const map = await processMap();
  await syncBindingsForOnlineApps(apps, map);
  return apps.map((app) => publicApp(app, map[pm2Name(app.id)]));
};
export const getLogs = async (app) => ({ deploy: await tail(deployLog(app), 180), pm2Out: await tail(pm2OutLog(app), 180), pm2Err: await tail(pm2ErrLog(app), 180), lastError: app.lastError || '' });

export async function createApp(body) {
  // Validate user input and choose a free port if caller omitted one.
  const apps = getApps();
  const app = validateInput({ ...body, port: body.port || await suggestPort(apps) });
  if (app.authMethod === 'ssh' && app.sshKeyName) resolveGitSshConfig(app);
  app.port = await ensurePort(app.port, apps);
  apps.push(app);
  await saveApps(apps);
  return sanitize(app);
}

export async function updateApp(id, body) {
  // Merge updates over current stored app then re-validate all constraints.
  const apps = getApps();
  const i = apps.findIndex((app) => app.id === id);
  if (i < 0) throw new Error('not found');
  const before = apps[i];
  const app = validateInput({ ...before, ...body }, before);
  if (app.authMethod === 'ssh' && app.sshKeyName) resolveGitSshConfig(app);
  app.port = body.port ? await ensurePort(app.port, apps, id) : before.port;
  apps[i] = app;
  await saveApps(apps);
  const live = await sanitize(app);
  // Tell UI when config drift means "restart" is required to apply changes.
  const restartRequired = live.status === 'online' && ['repoUrl', 'branch', 'subdir', 'port', 'authMethod', 'authUsername', 'sshKeyName', 'envEnc', 'runtimeEnvFileName'].some((k) => String(before[k] || '') !== String(app[k] || ''));
  return { app: live, restartRequired };
}

export async function deployApp(id) {
  const apps = getApps();
  const app = apps.find((item) => item.id === id);
  if (!app) throw new Error('not found');
  return withLock(id, async () => {
    // Deploy sequence: git sync -> sam build -> PM2 restart.
    await resetLog(deployLog(app), `Deploy ${app.name}`);
    try {
      await syncRepo(app, deployLog(app));
      await runSamBuild(app, deployLog(app));
      await restartProcess(app);
      await syncAppProxies(app);
      app.lastDeployAt = app.updatedAt = new Date().toISOString();
      app.lastDeploySummary = 'Deploy finished successfully';
      app.lastError = null;
      await saveApps(apps);
    } catch (error) {
      app.lastDeploySummary = 'Deploy failed';
      app.lastError = error.message;
      app.updatedAt = new Date().toISOString();
      await saveApps(apps);
      throw error;
    }
  });
}

export async function startApp(id) {
  const apps = getApps();
  const app = apps.find((item) => item.id === id);
  if (!app) throw new Error('not found');
  return withLock(id, async () => {
    // Start is implemented as stop + preflight checks + fresh start.
    await stopProcess(app);
    await ensurePort(app.port, apps, id);
    await startProcess(app);
    await waitOnline(app);
    await syncAppProxies(app);
    app.lastError = null;
    app.updatedAt = new Date().toISOString();
    await saveApps(apps);
  });
}
export async function restartApp(id) { return startApp(id); }
export async function stopApp(id) {
  // Stop is idempotent: PM2 delete callback resolves regardless of process existence.
  const apps = getApps();
  const app = apps.find((item) => item.id === id);
  if (!app) throw new Error('not found');
  return withLock(id, async () => {
    await stopProcess(app);
    await stopAppProxies(app.id);
  });
}
export async function deleteApp(id) {
  // Deleting an app also attempts to stop its PM2 process first.
  const apps = getApps();
  const i = apps.findIndex((item) => item.id === id);
  if (i < 0) throw new Error('not found');
  await withLock(id, async () => {
    await stopProcess(apps[i]);
    await stopAppProxies(apps[i].id);
    apps.splice(i, 1);
    await saveApps(apps);
  });
}

export async function addAttachment(id, body = {}) {
  const apps = getApps();
  const app = apps.find((item) => item.id === id);
  if (!app) throw new Error('not found');
  const next = { id: `ra-${nanoid(6)}`, ...ensureAttachmentInput(body) };
  checkAttachmentConflict(apps, id, next);
  if (!(await isSocketFree(next.bindHost, next.bindPort))) throw new Error(`bind ${next.bindHost}:${next.bindPort} is already in use`);
  app.remoteAttachments = [...(app.remoteAttachments || []), next];
  await saveApps(apps);

  const map = await processMap();
  if (isOnline(map, app)) await ensureAttachmentProxy(app, next);
  return { app: publicApp(app, map[pm2Name(app.id)]) };
}

export async function deleteAttachment(id, attachmentId) {
  const apps = getApps();
  const app = apps.find((item) => item.id === id);
  if (!app) throw new Error('not found');
  const before = app.remoteAttachments || [];
  const next = before.filter((item) => item.id !== attachmentId);
  if (next.length === before.length) throw new Error('not found');
  app.remoteAttachments = next;
  await saveApps(apps);
  await stopAttachmentProxy(id, attachmentId);
  const map = await processMap();
  return { app: publicApp(app, map[pm2Name(app.id)]) };
}
