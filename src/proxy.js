import http from 'node:http';

const bindings = new Map();
const keyOf = (appId, attachmentId) => `${appId}:${attachmentId}`;

const createProxyServer = (targetPort) => http.createServer((req, res) => {
  const upstream = http.request({
    protocol: 'http:',
    hostname: '127.0.0.1',
    port: targetPort,
    method: req.method,
    path: req.url,
    headers: req.headers
  }, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });

  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('upstream unavailable');
  });

  req.pipe(upstream);
});

export async function stopAttachmentProxy(appId, attachmentId) {
  const key = keyOf(appId, attachmentId);
  const record = bindings.get(key);
  if (!record) return;
  await new Promise((resolve) => record.server.close(() => resolve()));
  bindings.delete(key);
}

export async function stopAppProxies(appId) {
  await Promise.all([...bindings.keys()].filter((key) => key.startsWith(`${appId}:`)).map((key) => {
    const attachmentId = key.slice(appId.length + 1);
    return stopAttachmentProxy(appId, attachmentId);
  }));
}

export async function ensureAttachmentProxy(app, attachment) {
  const key = keyOf(app.id, attachment.id);
  const current = bindings.get(key);

  // Restart only when bind target or app port changed.
  if (current && current.bindHost === attachment.bindHost && current.bindPort === Number(attachment.bindPort) && current.targetPort === Number(app.port)) return;
  if (current) await stopAttachmentProxy(app.id, attachment.id);

  const server = createProxyServer(app.port);
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(attachment.bindPort), attachment.bindHost, () => {
      server.off('error', reject);
      resolve();
    });
  });

  bindings.set(key, {
    server,
    bindHost: attachment.bindHost,
    bindPort: Number(attachment.bindPort),
    targetPort: Number(app.port)
  });
}

export async function syncAppProxies(app) {
  const desired = new Set((app.remoteAttachments || []).map((attachment) => keyOf(app.id, attachment.id)));
  const stale = [...bindings.keys()].filter((key) => key.startsWith(`${app.id}:`) && !desired.has(key));
  await Promise.all(stale.map((key) => stopAttachmentProxy(app.id, key.slice(app.id.length + 1))));
  for (const attachment of app.remoteAttachments || []) await ensureAttachmentProxy(app, attachment);
}


