import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { ASKPASS_FILE, ROOT } from './config.js';
import { decrypt } from './secure.js';
import { repoDir } from './model.js';
import { appendLogSafe } from './logs.js';
import { resolveGitSshConfig } from './ssh.js';

// Build process environment for Git based on selected authentication mode.
// The app forces non-interactive auth to avoid hanging prompts in background jobs.
const envFor = (app) => {
  if (app.authMethod === 'public') return { GIT_TERMINAL_PROMPT: '0' };
  if (app.authMethod === 'ssh') return { GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: resolveGitSshConfig(app).command };
  return {
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: ASKPASS_FILE,
    GIT_ASKPASS_REQUIRE: 'force',
    GIT_UI_USERNAME: app.authUsername || 'git',
    GIT_UI_SECRET: decrypt(app.secretEnc)
  };
};

// simple-git blocks some Git auth env vars by default as a safety measure.
// We opt in only for the exact auth mode that needs each variable:
// - SSH mode needs GIT_SSH_COMMAND so Git stays non-interactive.
// - HTTPS credential/token modes need GIT_ASKPASS for non-interactive auth.
const optionsFor = (baseDir, app) => ({
  baseDir,
  trimmed: false,
  unsafe: {
    allowUnsafeSshCommand: app.authMethod === 'ssh',
    allowUnsafeAskPass: ['https_credentials', 'https_token'].includes(app.authMethod)
  }
});

// Create a simple-git client with auth env pre-wired.
const git = (baseDir, app) => Object.entries(envFor(app)).reduce((g, [k, v]) => g.env(k, v), simpleGit(optionsFor(baseDir, app)));

const normalizeGitError = (error, app) => {
  const text = String(error?.stderr || error?.message || error?.shortMessage || '').trim();
  if (/host key verification failed/i.test(text)) {
    return 'SSH host key verification failed even after auto-trusting new hosts. If this host recently changed keys, delete data/ssh-known-hosts and try again.';
  }
  if (/permission denied \(publickey\)/i.test(text)) {
    let sshLabel = '';
    if (app?.authMethod === 'ssh') {
      try { sshLabel = resolveGitSshConfig(app).label; }
      catch { sshLabel = app.sshKeyName || ''; }
    }
    return `SSH authentication failed${sshLabel ? ` using ${sshLabel}` : ''}. Add the matching public key to your Git provider or choose a different SSH key.`;
  }
  return text || 'git operation failed';
};

export async function syncRepo(app, logFile) {
  const dir = repoDir(app);
  const root = git(ROOT, app);
  if (app.authMethod === 'ssh') {
    const sshConfig = resolveGitSshConfig(app);
    await appendLogSafe(logFile, `$ using SSH key: ${sshConfig.label}\n`);
  }

  // Validate branch existence up front so users get a clean error before clone/fetch.
  await appendLogSafe(logFile, '\n$ git ls-remote --heads <repo> <branch>\n');
  let heads = '';
  try {
    heads = await root.listRemote(['--heads', app.repoUrl, app.branch]);
  } catch (error) {
    throw new Error(normalizeGitError(error, app));
  }
  if (!heads.trim()) throw new Error(`branch not found: ${app.branch}`);

  // Existing repo: fetch and hard-reset local branch to origin/branch.
  if (existsSync(join(dir, '.git'))) {
    const repo = git(dir, app);
    try {
      await appendLogSafe(logFile, '$ git fetch origin <branch> --prune\n');
      await repo.fetch('origin', app.branch, { '--prune': null });
      await appendLogSafe(logFile, '$ git checkout -B <branch> origin/<branch>\n');
      await repo.checkout(['-B', app.branch, `origin/${app.branch}`]);
    } catch (error) {
      throw new Error(normalizeGitError(error, app));
    }
    return;
  }

  // First deploy: clone only requested branch for speed and clarity.
  try {
    await appendLogSafe(logFile, '$ git clone --branch <branch> <repo>\n');
    await root.clone(app.repoUrl, dir, ['--branch', app.branch, '--single-branch']);
  } catch (error) {
    throw new Error(normalizeGitError(error, app));
  }
}
