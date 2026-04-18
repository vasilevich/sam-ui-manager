import { existsSync } from 'node:fs';
import { execa } from 'execa';
import { workDir } from './model.js';
import { appendLogSafe } from './logs.js';

// Support both .yaml and .yml to avoid surprising template naming failures.
export const templatePath = (app) => ['template.yaml', 'template.yml'].find((name) => existsSync(`${workDir(app)}/${name}`));
export const builtTemplate = (app) => ['.aws-sam/build/template.yaml', '.aws-sam/build/template.yml'].find((name) => existsSync(`${workDir(app)}/${name}`));

export async function validateSamApp(app) {
  // Confirm configured subdirectory exists and contains a SAM template.
  const dir = workDir(app);
  if (!existsSync(dir)) throw new Error(`subdirectory not found: ${app.subdir}`);
  if (!templatePath(app)) throw new Error(`template.yaml not found in ${app.subdir}`);
  return dir;
}

export async function checkPrereqs() {
  // Build/start require both SAM CLI and Docker runtime.
  try { await execa('sam', ['--version']); } catch { throw new Error('SAM CLI is not installed or not on PATH'); }
  try { await execa('docker', ['info']); } catch { throw new Error('Docker is not running or not reachable'); }
}

export async function runSamBuild(app, logFile) {
  const cwd = await validateSamApp(app);
  await checkPrereqs();

  // Persist command output for debugging via the dashboard log panel.
  await appendLogSafe(logFile, '\n$ sam build\n');
  try {
    const { all } = await execa('sam', ['build'], { cwd, all: true });
    await appendLogSafe(logFile, `${all || ''}\n`);
  } catch (error) {
    await appendLogSafe(logFile, `${error.all || error.stderr || error.message || ''}\n`);
    throw new Error((error.stderr || error.shortMessage || error.message || 'sam build failed').trim());
  }
}

export const startArgs = (app) => {
  // `sam local start-api` serves from built template when available.
  // This mirrors typical local workflow: build once, then run containers.
  const args = ['local', 'start-api'];
  const built = builtTemplate(app);
  if (built) args.push('--template', built);
  args.push('--warm-containers', 'EAGER', '--container-host-interface', '127.0.0.1', '--port', String(app.port), '--disable-authorizer');
  return args;
};
