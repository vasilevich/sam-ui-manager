import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT } from '../src/config.js';
import { runSamBuild, checkPrereqs, detectSamCapabilities, startArgs } from '../src/sam.js';

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

