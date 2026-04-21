import express from 'express';
import { networkInterfaces } from 'node:os';
import { HOST, PORT } from './config.js';
import { findApp } from './db.js';
import { addAttachment, createApp, deleteApp, deleteAttachment, deployApp, getLogs, listApps, restartApp, startApp, stopApp, suggestPort, updateApp } from './service.js';
import { deleteFileBackedPublicKey, ensurePublicKey, generateNewPublicKey, listUsablePublicKeys } from './ssh.js';

// Keep route handlers clean by centralizing async error handling.
// Convention: explicit "not found" errors map to 404, everything else to 400.
const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (error) { res.status(error.message === 'not found' ? 404 : 400).json({ error: error.message || 'unknown error' }); }
};

export const router = express.Router();

const bindInterfaces = () => {
  const out = new Set(['0.0.0.0', '127.0.0.1']);
  for (const entries of Object.values(networkInterfaces())) {
    for (const item of entries || []) {
      if (item?.family === 'IPv4' && item.address) out.add(item.address);
    }
  }
  return [...out];
};

// Dashboard metadata: where UI is hosted + next suggested app port.
router.get('/meta', wrap(async (_req, res) => res.json({ host: HOST, dashboardPort: PORT, suggestedPort: await suggestPort(), bindInterfaces: bindInterfaces() })));

// Explicit helper endpoint for the "Pick Free Port" button.
router.get('/ports/suggest', wrap(async (_req, res) => res.json({ port: await suggestPort() })));

// SSH helper endpoints for UI: inspect usable public keys and generate one if needed.
router.get('/ssh/keys', wrap(async (_req, res) => {
  const keys = await listUsablePublicKeys();
  res.json({ keys, hasKeys: keys.length > 0, canGenerate: true });
}));
router.post('/ssh/keys', wrap(async (_req, res) => res.json({ ok: true, ...(await ensurePublicKey()) })));
router.post('/ssh/keys/new', wrap(async (_req, res) => res.json({ ok: true, ...(await generateNewPublicKey()) })));
router.delete('/ssh/keys/:name', wrap(async (req, res) => res.json({ ok: true, ...(await deleteFileBackedPublicKey(req.params.name)) })));

// List all managed projects with live PM2 status.
router.get('/apps', wrap(async (_req, res) => res.json({ apps: await listApps() })));

// Return recent deploy/stdout/stderr logs for one project.
router.get('/apps/:id/logs', wrap(async (req, res) => {
  const app = findApp(req.params.id);
  if (!app) throw new Error('not found');
  res.json(await getLogs(app));
}));

// CRUD + lifecycle endpoints used by the dashboard actions.
router.post('/apps', wrap(async (req, res) => res.json({ ok: true, app: await createApp(req.body || {}) })));
router.patch('/apps/:id', wrap(async (req, res) => res.json({ ok: true, ...(await updateApp(req.params.id, req.body || {})) })));
router.post('/apps/:id/deploy', wrap(async (req, res) => { await deployApp(req.params.id); res.json({ ok: true }); }));
router.post('/apps/:id/start', wrap(async (req, res) => { await startApp(req.params.id); res.json({ ok: true }); }));
router.post('/apps/:id/restart', wrap(async (req, res) => { await restartApp(req.params.id); res.json({ ok: true }); }));
router.post('/apps/:id/stop', wrap(async (req, res) => { await stopApp(req.params.id); res.json({ ok: true }); }));
router.post('/apps/:id/attachments', wrap(async (req, res) => res.json({ ok: true, ...(await addAttachment(req.params.id, req.body || {})) })));
router.delete('/apps/:id/attachments/:attachmentId', wrap(async (req, res) => res.json({ ok: true, ...(await deleteAttachment(req.params.id, req.params.attachmentId)) })));
router.delete('/apps/:id', wrap(async (req, res) => { await deleteApp(req.params.id); res.json({ ok: true }); }));
