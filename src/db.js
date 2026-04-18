import { JSONFilePreset } from 'lowdb/node';
import { DB_FILE } from './config.js';
import { normalizeApp } from './model.js';

// Single-file JSON database for a lightweight, dependency-free setup.
export const db = await JSONFilePreset(DB_FILE, { apps: [] });

// Always normalize on read/write so schema stays consistent over time.
export const getApps = () => (db.data.apps || []).map(normalizeApp);
export const findApp = (id) => getApps().find((app) => app.id === id);
export const saveApps = async (apps) => { db.data.apps = apps.map(normalizeApp); await db.write(); };
export const updateApps = async (fn) => { const apps = getApps(); const value = await fn(apps); await saveApps(apps); return value; };
