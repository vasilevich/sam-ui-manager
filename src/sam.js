import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execa } from 'execa';
import { workDir } from './model.js';
import { appendLogSafe } from './logs.js';

// Support both .yaml and .yml to avoid surprising template naming failures.
export const templatePath = (app) => ['template.yaml', 'template.yml'].find((name) => existsSync(`${workDir(app)}/${name}`));
export const builtTemplate = (app) => ['.aws-sam/build/template.yaml', '.aws-sam/build/template.yml'].find((name) => existsSync(`${workDir(app)}/${name}`));

const toAbsolute = (cwd, rel = '') => resolve(join(cwd, rel));
const hasMakefileBuildMethod = (templateFile) => /(^|\n)\s*BuildMethod\s*:\s*makefile\s*(\n|$)/i.test(readFileSync(templateFile, 'utf8'));
const detectEnvVarsFile = (cwd) => ['env.json', 'env.local.json', 'env.example.json'].find((name) => existsSync(join(cwd, name))) || null;

const runVersionCheck = async (cmd, args = ['--version'], runner = execa) => {
  try {
    const { stdout = '', stderr = '' } = await runner(cmd, args);
    const out = String(stdout || stderr || '').trim();
    return { ok: true, cmd, version: out || 'ok' };
  } catch {
    return { ok: false, cmd, version: 'missing' };
  }
};

const failMissingTool = (tool, hint) => new Error(`${tool} is required for this SAM project but was not found on PATH. ${hint}`);

export function detectSamCapabilities(app) {
  const cwd = workDir(app);
  const relTemplate = templatePath(app);
  if (!relTemplate) throw new Error(`template.yaml not found in ${app.subdir}`);
  const sourceTemplateFile = toAbsolute(cwd, relTemplate);
  return {
    cwd,
    sourceTemplateFile,
    templateDir: dirname(sourceTemplateFile),
    usesMakefileBuilder: hasMakefileBuildMethod(sourceTemplateFile),
    envVarsFile: detectEnvVarsFile(cwd)
  };
}

export async function validateSamApp(app) {
  // Confirm configured subdirectory exists and contains a SAM template.
  const dir = workDir(app);
  if (!existsSync(dir)) throw new Error(`subdirectory not found: ${app.subdir}`);
  return detectSamCapabilities(app).cwd;
}

export async function checkPrereqs({ needsMakefileBuilder = false, runner = execa } = {}) {
  // Build/start require both SAM CLI and Docker runtime.
  const samCheck = await runVersionCheck('sam', ['--version'], runner);
  if (!samCheck.ok) throw new Error('SAM CLI is not installed or not on PATH');
  const dockerCheck = await runVersionCheck('docker', ['--version'], runner);
  if (!dockerCheck.ok) throw new Error('Docker is not running or not reachable');
  try { await runner('docker', ['info']); }
  catch { throw new Error('Docker is not running or not reachable'); }

  const diagnostics = { sam: samCheck.version, docker: dockerCheck.version, path: process.env.PATH || '' };
  if (needsMakefileBuilder) {
    const makeCheck = await runVersionCheck('make', ['--version'], runner);
    if (!makeCheck.ok) throw failMissingTool('make', 'Install build tools in the SAM build environment (Ubuntu/Debian: apt-get install -y make golang; Alpine: apk add --no-cache make go; Amazon Linux/RHEL: yum install -y make golang).');
    const goCheck = await runVersionCheck('go', ['version'], runner);
    if (!goCheck.ok) throw failMissingTool('go', 'Install the Go toolchain in the SAM build environment (Ubuntu/Debian: apt-get install -y golang; Alpine: apk add --no-cache go; Amazon Linux/RHEL: yum install -y golang).');
    diagnostics.make = makeCheck.version;
    diagnostics.go = goCheck.version;
  }
  return diagnostics;
}

export async function runSamBuild(app, logFile, { runner = execa } = {}) {
  const capabilities = detectSamCapabilities(app);
  const { cwd, sourceTemplateFile, usesMakefileBuilder } = capabilities;
  const diagnostics = await checkPrereqs({ needsMakefileBuilder: usesMakefileBuilder, runner });
  const command = ['build', '--template-file', sourceTemplateFile];

  // Persist command output for debugging via the dashboard log panel.
  await appendLogSafe(logFile, '\n$ sam build --template-file <template>\n');
  await appendLogSafe(logFile, `$ SAM build cwd: ${cwd}\n`);
  await appendLogSafe(logFile, `$ SAM template: ${sourceTemplateFile}\n`);
  await appendLogSafe(logFile, `$ BuildMethod makefile detected: ${usesMakefileBuilder ? 'yes' : 'no'}\n`);
  await appendLogSafe(logFile, `$ Tool diagnostics: sam=${diagnostics.sam}; docker=${diagnostics.docker}${diagnostics.make ? `; make=${diagnostics.make}` : ''}${diagnostics.go ? `; go=${diagnostics.go}` : ''}\n`);
  await appendLogSafe(logFile, `$ PATH: ${diagnostics.path}\n`);
  try {
    const { all } = await runner('sam', command, { cwd, all: true });
    await appendLogSafe(logFile, `${all || ''}\n`);
  } catch (error) {
    await appendLogSafe(logFile, `${error.all || error.stderr || error.message || ''}\n`);
    throw new Error((error.stderr || error.shortMessage || error.message || 'sam build failed').trim());
  }
}

export const startArgs = (app) => {
  // `sam local start-api` serves from built template when available.
  // This mirrors typical local workflow: build once, then run containers.
  const capabilities = detectSamCapabilities(app);
  const args = ['local', 'start-api'];
  const built = builtTemplate(app);
  const templateFile = built ? toAbsolute(capabilities.cwd, built) : capabilities.sourceTemplateFile;
  args.push('--template-file', templateFile);
  if (capabilities.envVarsFile) args.push('--env-vars', toAbsolute(capabilities.cwd, capabilities.envVarsFile));
  args.push('--warm-containers', 'EAGER', '--container-host-interface', '127.0.0.1', '--port', String(app.port), '--disable-authorizer');
  return args;
};
