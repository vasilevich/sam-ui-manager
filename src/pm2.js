import pm2 from 'pm2';
import { pm2ErrLog, pm2OutLog, tail } from './logs.js';
import { pm2Name, workDir } from './model.js';
import { startArgs, syncRuntimeEnvFile, validateSamApp } from './sam.js';

// PM2 has callback APIs; wrap connect/list/start/delete into Promises.
const call = (fn) => new Promise((resolve, reject) => pm2.connect((err) => err ? reject(err) : Promise.resolve(fn()).then(resolve, reject).finally(() => pm2.disconnect())));
const listRaw = () => call(() => new Promise((resolve, reject) => pm2.list((err, list) => err ? reject(err) : resolve(list))));

// Map by process name so service layer can quickly lookup one app status.
export const processMap = async () => Object.fromEntries((await listRaw()).map((p) => [p.name, p]));

// Delete process if present; PM2 callback resolves even if process does not exist.
export const stopProcess = async (app) => call(() => new Promise((resolve) => pm2.delete(pm2Name(app.id), () => resolve())));

export async function startProcess(app) {
  // Validate SAM project shape before letting PM2 spawn anything.
  await validateSamApp(app);
  await syncRuntimeEnvFile(app);
  return call(() => new Promise((resolve, reject) => pm2.start({
    name: pm2Name(app.id),
    script: 'sam',
    args: startArgs(app).join(' '),
    cwd: workDir(app),
    interpreter: 'none',
    output: pm2OutLog(app),
    error: pm2ErrLog(app),
    time: true,
    autorestart: true
  }, (err) => err ? reject(err) : resolve())));
}

export async function waitOnline(app) {
  // Poll PM2 briefly to confirm process reached online state after start/restart.
  for (let i = 0; i < 16; i++) {
    const proc = (await processMap())[pm2Name(app.id)];
    if (proc?.pm2_env?.status === 'online') return;
    if (proc?.pm2_env?.status === 'errored' || proc?.pm2_env?.status === 'stopped') break;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error((await tail(pm2ErrLog(app), 80)) || 'process did not reach online state');
}

export async function restartProcess(app) {
  // Keep restart semantics deterministic across PM2 versions.
  await stopProcess(app);
  await startProcess(app);
  await waitOnline(app);
}
