import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LOG_DIR } from './config.js';

// One file per app + log type to keep dashboard retrieval simple.
const file = (app, kind) => join(LOG_DIR, `${app.id}.${kind}.log`);
export const deployLog = (app) => file(app, 'deploy');
export const pm2OutLog = (app) => file(app, 'pm2.out');
export const pm2ErrLog = (app) => file(app, 'pm2.err');

export const resetLog = async (path, title) => {
  await mkdir(LOG_DIR, { recursive: true });
  await writeFile(path, `[${new Date().toISOString()}] ${title}\n`);
};

export const appendLogSafe = async (path, text = '') => {
  await mkdir(LOG_DIR, { recursive: true });
  await appendFile(path, String(text));
};

export const tail = async (path, lines = 150) => {
  // Missing logs are normal before first deploy/start, so return empty string.
  try { return (await readFile(path, 'utf8')).split(/\r?\n/).slice(-lines).join('\n').trim(); }
  catch { return ''; }
};
