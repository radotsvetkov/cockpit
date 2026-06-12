// Dev error surface: paints uncaught errors (incl. module-graph failures)
// into the page so a screenshot can read them - the WKWebView console is
// hard to reach headlessly. Loaded as its own <script type="module"> so it
// runs even when app.js's import graph fails. Harmless in production: it
// renders nothing unless something is already broken.
function box() {
  let b = document.getElementById('errortrap');
  if (!b) {
    b = document.createElement('div');
    b.id = 'errortrap';
    b.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:99999;background:#3d1014;' +
      'color:#ff8a80;font:11px ui-monospace,monospace;padding:6px 10px;' +
      'white-space:pre-wrap;max-height:45vh;overflow:auto;';
    (document.body || document.documentElement).appendChild(b);
  }
  return b;
}
window.addEventListener(
  'error',
  (e) => {
    const t = e.target && e.target.src ? ` [load failed: ${e.target.src}]` : '';
    box().textContent += `[error] ${e.message || ''}${t} @ ${e.filename || ''}:${e.lineno || ''}\n`;
  },
  true
);
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  box().textContent += `[rejection] ${(r && (r.stack || r.message)) || String(r)}\n`;
});
// Release posture: the trap stays invisible unless something actually
// breaks - then the red banner is the failure surface. (The dev-only
// "armed" marker and title reporter were removed for release.)
