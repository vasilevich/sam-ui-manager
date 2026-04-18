import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve project root from this file location so paths work on any OS.
const SRC = dirname(fileURLToPath(import.meta.url));
export const ROOT = dirname(SRC);

// Dashboard host/port (override through environment variables).
export const HOST = process.env.HOST || '127.0.0.1';
export const PORT = Number(process.env.PORT || 8787);

// Ports reserved for managed SAM applications when "suggest port" is used.
export const PORT_RANGE = [58000, 58999];

// Runtime file system layout.
export const DATA_DIR = join(ROOT, 'data');
export const REPO_DIR = join(ROOT, 'repos');
export const LOG_DIR = join(DATA_DIR, 'logs');
export const PUBLIC_DIR = join(ROOT, 'public');
export const DB_FILE = join(DATA_DIR, 'apps.json');
export const KEY_FILE = join(DATA_DIR, '.secret.key');
export const ASKPASS_FILE = join(DATA_DIR, 'git-askpass.cjs');
export const KNOWN_HOSTS_FILE = join(DATA_DIR, 'ssh-known-hosts');

// Bootstrapping side effects: ensure all required runtime directories exist.
[DATA_DIR, REPO_DIR, LOG_DIR, PUBLIC_DIR].forEach((dir) => mkdirSync(dir, { recursive: true }));

// Persist app metadata in a simple JSON file if this is first startup.
if (!existsSync(DB_FILE)) writeFileSync(DB_FILE, '{"apps":[]}\n');

// Create one local encryption key for Git secrets (not checked into source control).
if (!existsSync(KEY_FILE)) writeFileSync(KEY_FILE, randomBytes(32).toString('hex'), { mode: 0o600 });

// Keep SSH host trust local to this app so first SSH deploys can work without manual setup.
// The file starts empty and OpenSSH will append first-seen hosts when we use `accept-new`.
if (!existsSync(KNOWN_HOSTS_FILE)) writeFileSync(KNOWN_HOSTS_FILE, '', { mode: 0o600 });

// Small helper script used by Git to answer username/token prompts non-interactively.
if (!existsSync(ASKPASS_FILE)) writeFileSync(ASKPASS_FILE, `#!/usr/bin/env node
const prompt = String(process.argv[2] || '');
process.stdout.write(/username/i.test(prompt) ? (process.env.GIT_UI_USERNAME || '') : (process.env.GIT_UI_SECRET || ''));
`, { mode: 0o755 });
