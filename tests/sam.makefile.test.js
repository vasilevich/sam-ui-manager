import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT } from '../src/config.js';
import { runSamBuild, checkPrereqs, detectSamCapabilities, startArgs } from '../src/sam.js';
import { encrypt } from '../src/secure.js';

const fixtureRoot = join(ROOT, 'tests', 'fixtures');
const reposRoot = join(ROOT, 'repos');

const stageFixture = (fixtureName) => {
  const id = `app-test-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const target = join(reposRoot, id);
  mkdirSync(reposRoot, { recursive: true });
  cpSync(join(fixtureRoot, fixtureName), target, { recursive: true });
  return {
    app: {
      id,
      name: `Fixture ${fixtureName}`,
      subdir: '.',
      port: 58001,
      authMethod: 'public'
    },
    target
  };
};

const cleanup = (path) => rmSync(path, { recursive: true, force: true });

test('preflight reports actionable error when make is missing for makefile builds', async () => {
  const runner = async (cmd, args) => {
    if (cmd === 'sam') return { stdout: 'SAM CLI, version 1.120.0' };
    if (cmd === 'docker' && args[0] === '--version') return { stdout: 'Docker version 26.0.0' };
    if (cmd === 'docker' && args[0] === 'info') return { stdout: 'ok' };
    if (cmd === 'make') throw new Error('missing make');
    throw new Error(`unexpected command ${cmd}`);
  };

  await assert.rejects(
    () => checkPrereqs({ needsMakefileBuilder: true, runner }),
    /make is required.*apt-get install -y make golang/i
  );
});

test('preflight reports actionable error when go is missing for makefile builds', async () => {
  const runner = async (cmd, args) => {
    if (cmd === 'sam') return { stdout: 'SAM CLI, version 1.120.0' };
    if (cmd === 'docker' && args[0] === '--version') return { stdout: 'Docker version 26.0.0' };
    if (cmd === 'docker' && args[0] === 'info') return { stdout: 'ok' };
    if (cmd === 'make') return { stdout: 'GNU Make 4.4.1' };
    if (cmd === 'go') throw new Error('missing go');
    throw new Error(`unexpected command ${cmd}`);
  };

  await assert.rejects(
    () => checkPrereqs({ needsMakefileBuilder: true, runner }),
    /go is required.*apt-get install -y golang/i
  );
});

test('makefile fixture detects capabilities and builds with explicit template path', async () => {
  const { app, target } = stageFixture('makefile-go');
  const logPath = join(mkdtempSync(join(tmpdir(), 'sam-ui-manager-test-')), 'deploy.log');
  const calls = [];

  try {
    const runner = async (cmd, args, opts = {}) => {
      calls.push({ cmd, args, cwd: opts.cwd || '' });
      if (cmd === 'sam' && args[0] === '--version') return { stdout: 'SAM CLI, version 1.120.0' };
      if (cmd === 'docker' && args[0] === '--version') return { stdout: 'Docker version 26.0.0' };
      if (cmd === 'docker' && args[0] === 'info') return { stdout: 'ok' };
      if (cmd === 'make') return { stdout: 'GNU Make 4.4.1' };
      if (cmd === 'go') return { stdout: 'go version go1.22.1 linux/amd64' };
      if (cmd === 'sam' && args[0] === 'build') {
        const bootstrap = join(target, '.aws-sam', 'build', 'PaymentApiFunction', 'bootstrap');
        mkdirSync(join(target, '.aws-sam', 'build', 'PaymentApiFunction'), { recursive: true });
        writeFileSync(bootstrap, 'binary');
        writeFileSync(join(target, '.aws-sam', 'build', 'template.yaml'), readFileSync(join(target, 'template.yaml'), 'utf8'));
        return { all: 'Build Succeeded\nPaymentApiFunction' };
      }
      throw new Error(`unexpected command ${cmd} ${args.join(' ')}`);
    };

    await runSamBuild(app, logPath, { runner });

    const buildCall = calls.find((item) => item.cmd === 'sam' && item.args[0] === 'build');
    assert.ok(buildCall, 'sam build should be called');
    assert.equal(buildCall.cwd, target, 'sam build should run in repo root');
    assert.equal(buildCall.args[1], '--template-file');
    assert.equal(buildCall.args[2], join(target, 'template.yaml'));
    assert.ok(existsSync(join(target, '.aws-sam', 'build', 'PaymentApiFunction', 'bootstrap')));

    const logOutput = readFileSync(logPath, 'utf8');
    assert.match(logOutput, /SAM build cwd:/);
    assert.match(logOutput, /SAM template:/);
    assert.match(logOutput, /make=/);
    assert.match(logOutput, /go=/);

    const args = startArgs({ ...app, port: 3000 });
    assert.ok(args.includes('--template-file'));
    assert.ok(args.includes(join(target, '.aws-sam', 'build', 'template.yaml')));
    assert.ok(args.includes('--env-vars'));
    assert.ok(args.includes(join(target, 'env.example.json')));
  } finally {
    cleanup(target);
    cleanup(join(logPath, '..'));
  }
});

test('makefile build auto-runs go mod tidy and retries once on missing go.sum', async () => {
  const { app, target } = stageFixture('makefile-go');
  const logPath = join(mkdtempSync(join(tmpdir(), 'sam-ui-manager-test-')), 'deploy.log');
  const calls = [];
  let buildAttempts = 0;

  try {
    writeFileSync(join(target, 'go.mod'), 'module sample\n\ngo 1.22\n');
    const runner = async (cmd, args, opts = {}) => {
      calls.push({ cmd, args, cwd: opts.cwd || '' });
      if (cmd === 'sam' && args[0] === '--version') return { stdout: 'SAM CLI, version 1.120.0' };
      if (cmd === 'docker' && args[0] === '--version') return { stdout: 'Docker version 26.0.0' };
      if (cmd === 'docker' && args[0] === 'info') return { stdout: 'ok' };
      if (cmd === 'make') return { stdout: 'GNU Make 4.4.1' };
      if (cmd === 'go' && args[0] === 'version') return { stdout: 'go version go1.22.1 linux/amd64' };
      if (cmd === 'go' && args[0] === 'mod' && args[1] === 'tidy') return { all: 'tidy ok' };
      if (cmd === 'sam' && args[0] === 'build') {
        buildAttempts += 1;
        if (buildAttempts === 1) {
          const err = new Error('build failed');
          err.all = 'missing go.sum entry for module providing package github.com/aws/aws-lambda-go/lambda';
          throw err;
        }
        return { all: 'Build Succeeded' };
      }
      throw new Error(`unexpected command ${cmd} ${args.join(' ')}`);
    };

    await runSamBuild(app, logPath, { runner });
    assert.equal(buildAttempts, 2, 'sam build should retry once after go mod tidy');
    assert.equal(calls.some((item) => item.cmd === 'go' && item.args[0] === 'mod' && item.args[1] === 'tidy'), true);

    const logOutput = readFileSync(logPath, 'utf8');
    assert.match(logOutput, /\$ go mod tidy/);
    assert.match(logOutput, /retry after go mod tidy/);
  } finally {
    cleanup(target);
    cleanup(join(logPath, '..'));
  }
});

test('stored project env is written to repo-root .env before build', async () => {
  const { app, target } = stageFixture('standard');
  const logPath = join(mkdtempSync(join(tmpdir(), 'sam-ui-manager-test-')), 'deploy.log');

  try {
    app.envEnc = encrypt('API_KEY=123\nMODE=dev');
    const runner = async (cmd, args, opts = {}) => {
      if (cmd === 'sam' && args[0] === '--version') return { stdout: 'SAM CLI, version 1.120.0' };
      if (cmd === 'docker' && args[0] === '--version') return { stdout: 'Docker version 26.0.0' };
      if (cmd === 'docker' && args[0] === 'info') return { stdout: 'ok' };
      if (cmd === 'sam' && args[0] === 'build') {
        assert.equal(opts.cwd, target);
        const envPath = join(target, '.env');
        assert.equal(existsSync(envPath), true, '.env should exist before build command');
        assert.equal(readFileSync(envPath, 'utf8'), 'API_KEY=123\nMODE=dev\n');
        return { all: 'Build Succeeded' };
      }
      throw new Error(`unexpected command ${cmd} ${args.join(' ')}`);
    };

    await runSamBuild(app, logPath, { runner });
    const logOutput = readFileSync(logPath, 'utf8');
    assert.match(logOutput, /synced runtime \.env: wrote repo-root \.env/);
  } finally {
    cleanup(target);
    cleanup(join(logPath, '..'));
  }
});

test('standard SAM fixture does not require make/go preflight', async () => {
  const { app, target } = stageFixture('standard');
  const logPath = join(mkdtempSync(join(tmpdir(), 'sam-ui-manager-test-')), 'deploy.log');

  try {
    const capabilities = detectSamCapabilities(app);
    assert.equal(capabilities.usesMakefileBuilder, false);

    const calls = [];
    const runner = async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === 'sam' && args[0] === '--version') return { stdout: 'SAM CLI, version 1.120.0' };
      if (cmd === 'docker' && args[0] === '--version') return { stdout: 'Docker version 26.0.0' };
      if (cmd === 'docker' && args[0] === 'info') return { stdout: 'ok' };
      if (cmd === 'sam' && args[0] === 'build') return { all: 'Build Succeeded' };
      if (cmd === 'make' || cmd === 'go') throw new Error('should not be called');
      throw new Error(`unexpected command ${cmd}`);
    };

    await runSamBuild(app, logPath, { runner });
    assert.equal(calls.some((item) => item.cmd === 'make'), false);
    assert.equal(calls.some((item) => item.cmd === 'go'), false);
  } finally {
    cleanup(target);
    cleanup(join(logPath, '..'));
  }
});

