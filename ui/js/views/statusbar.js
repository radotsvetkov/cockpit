/**
 * statusbar.js - Footer status strip (U8).
 *
 * Renders project root, autonomy pill, network stance, provider dots,
 * cache figures into #status-content.
 *
 * @module views/statusbar
 */

import { el, fmtBytes } from '../render.js';
import { get, subscribe } from '../state.js';
import { somaStatus, modelProbe, cacheStats } from '../soma.js';
import { showToast } from './toast.js';

/**
 * Mount the status bar: subscribes to state, renders immediately, and
 * wires the refresh button.
 */
export function mountStatusBar() {
  render();
  subscribe('status',     () => render());
  subscribe('modelProbe', () => render());
  subscribe('cacheStats', () => render());
  subscribe('currentProject', () => render());

  document.getElementById('status-refresh').addEventListener('click', () => {
    refreshStatus();
  });
}

/**
 * Fetch fresh status, modelProbe, cacheStats for the current project
 * and push to state.
 */
export async function refreshStatus() {
  const { setState } = await import('../state.js');
  const project = get('currentProject');
  if (!project) return;

  try {
    const [s, p, c] = await Promise.allSettled([
      somaStatus(project),
      modelProbe(project),
      cacheStats(project),
    ]);
    if (s.status === 'fulfilled' && s.value) setState({ status: s.value });
    if (p.status === 'fulfilled' && p.value) setState({ modelProbe: p.value });
    if (c.status === 'fulfilled' && c.value) setState({ cacheStats: c.value });

    if (s.status === 'rejected') console.warn('status --json:', s.reason);
    if (p.status === 'rejected') console.warn('model probe --json:', p.reason);
    if (c.status === 'rejected') console.warn('cache stats --json:', c.reason);
  } catch (e) {
    showToast(String(e), 'error');
  }
}

function render() {
  const bar = document.getElementById('status-content');
  if (!bar) return;

  const project = get('currentProject');
  const name    = get('currentProjectName');
  const status  = get('status');
  const probe   = get('modelProbe');
  const cache   = get('cacheStats');

  if (!project) {
    bar.innerHTML = '';
    bar.appendChild(el('span', { cls: 'dim', text: 'No project selected' }));
    return;
  }

  bar.innerHTML = '';

  // Project path
  const projectItem = el('span', { cls: 'status-item', title: project });
  projectItem.appendChild(el('span', { cls: 'dim', text: '⌂' }));
  projectItem.appendChild(el('span', { cls: 'mono', text: name || project.split('/').pop() }));
  bar.appendChild(projectItem);

  bar.appendChild(el('span', { cls: 'status-sep', text: '·' }));

  // Autonomy level
  if (status) {
    const autonomy = status.autonomy || '?';
    const cls = autonomy === 'auto' ? 'chip chip-amber' : autonomy === 'assist' ? 'chip chip-blue' : 'chip chip-gray';
    const item = el('span', { cls: 'status-item' });
    item.appendChild(el('span', { cls, text: autonomy }));
    bar.appendChild(item);

    bar.appendChild(el('span', { cls: 'status-sep', text: '·' }));

    // Network stance
    const net = status.network;
    if (net) {
      const networkItem = el('span', { cls: 'status-item' });
      if (!net.allow) {
        networkItem.appendChild(el('span', { cls: 'green', text: 'LOCAL-ONLY' }));
      } else {
        const hosts = (net.hosts || []).join(', ') || 'on';
        networkItem.appendChild(el('span', { cls: 'amber', text: `hybrid: ${hosts}` }));
      }
      bar.appendChild(networkItem);
      bar.appendChild(el('span', { cls: 'status-sep', text: '·' }));
    }
  }

  // Provider dots
  if (probe && probe.length > 0) {
    const probeItem = el('span', { cls: 'status-item' });
    for (const p of probe) {
      const dot = el('span', { cls: 'provider-dot', title: `${p.provider}: ${p.note || (p.ok ? 'ok' : 'error')}` });
      dot.appendChild(el('span', { cls: `dot ${p.ok ? 'dot-ok' : 'dot-err'}` }));
      dot.appendChild(el('span', { cls: 'dim', text: p.provider }));
      probeItem.appendChild(dot);
    }
    bar.appendChild(probeItem);
    bar.appendChild(el('span', { cls: 'status-sep', text: '·' }));
  }

  // Cache stats
  if (cache) {
    const cacheItem = el('span', { cls: 'status-item dim' });
    cacheItem.textContent = `${cache.entries ?? '?'} entries · ${fmtBytes(cache.bytes)} · ${cache.hits_total ?? '?'} hits`;
    bar.appendChild(cacheItem);
  }
}
