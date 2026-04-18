export const $ = (id) => document.getElementById(id);
export const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (m) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[m]));
export const fmtDate = (v) => v ? new Date(v).toLocaleString() : '—';
export const statusClass = (s) => `status-${String(s || 'stopped').replace(/[^a-z-]/g, '')}`;
export const showBanner = (text = '', kind = 'good') => { const n = $('banner'); n.textContent = text; n.className = `banner ${text ? 'show' : ''} ${kind}`; };
