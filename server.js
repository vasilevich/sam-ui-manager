import express from 'express';
import { HOST, PORT, PUBLIC_DIR } from './src/config.js';
import { router } from './src/routes.js';

// Entry point for the control panel backend + static frontend.
// `config.js` runs first and ensures required runtime folders/files exist.
const app = express();

// The UI sends JSON payloads for create/update actions.
app.use(express.json({ limit: '1mb' }));

// REST API for app lifecycle management lives under /api.
app.use('/api', router);

// Serve the dashboard assets (public/index.html, JS, CSS).
app.use(express.static(PUBLIC_DIR));

// Bind to configured interface/port and print the dashboard URL.
app.listen(PORT, HOST, () => console.log(`SAM UI Manager: http://${HOST}:${PORT}`));
