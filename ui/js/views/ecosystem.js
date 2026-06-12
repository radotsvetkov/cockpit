/**
 * ecosystem.js - HYT ecosystem tab (v4 §8c.6, read-only).
 *
 * Surfaces the sibling tools (akmon, agef-verify, memora) - presence and
 * version only; foreign configs are never read (they may hold secrets).
 * Mutations follow the conductor pattern: soma skills drive the binaries.
 *
 * @module views/ecosystem
 */

import { el, helpButton } from '../render.js';
import { showToast } from './toast.js';

let _mounted = false;

/**
 * Mount into a container element.
 * @param {HTMLElement} [containerEl] - target element; defaults to #view-container
 */
export async function mountEcosystem(containerEl) {
  _mounted = true;
  const container = containerEl || document.getElementById('view-container');
  if (!container) return;
  container.innerHTML = '';

  const header = el('div', { cls: 'section-header' });
  header.appendChild(el('h2', { cls: 'section-title', text: 'Ecosystem' }));
  header.appendChild(helpButton('Ecosystem', [
    'The HYT ecosystem is a set of cooperating binaries: soma (the policy enforcer and journal), akmon (the execution unit - full agent sessions with evidence), agef-verify (offline bundle verifier), and memora/memora-cli (verified citation-integrity memory).',
    'The conductor pattern: soma decides and gates; akmon executes and signs proof. This means you only audit soma\'s code for trust - a compromised cockpit or akmon is bounded by soma\'s policy.',
    'Foreign configs are never read here - they may hold secrets. Connect tools by adding their MCP server to mcp.json and importing their tools as skills, so every call stays policy-gated and journaled.',
  ]));
  container.appendChild(header);

  container.appendChild(el('div', {
    cls: 'config-journal-note',
    text: 'Read-only: presence + version. Foreign configs are never read (they may hold secrets). Mutations follow the conductor pattern - soma skills drive these binaries, policy-gated and journaled.',
  }));

  const grid = el('div', { id: 'eco-grid', cls: 'sessions-list' });
  container.appendChild(grid);

  const ROLES = {
    'akmon':       'Execution unit & evidence: full agent sessions (akmon-task skill), AGEF bundles, signing. soma decides - akmon executes and proves.',
    'agef-verify': 'Standalone offline verifier: anyone can check a bundle’s chain, objects, and signatures with this one binary. Used by the Exports board’s Verify buttons.',
    'memora':      'Verified memory: citation-integrity store. Integrate via MCP - add its server to mcp.json and import its tools as skills (MCP view).',
    'memora-cli':  'memora’s command-line interface - wrap calls as soma skills to keep them policy-gated and journaled.',
  };

  try {
    const tools = await window.__TAURI__.core.invoke('ecosystem_info');
    for (const t of tools) {
      const card = el('div', { cls: 'session-card' });
      const head = el('div', { cls: 'session-head' });
      head.appendChild(el('span', {
        cls: `chip ${t.exists ? 'chip-ok' : 'chip-fail'}`,
        text: t.exists ? '● present' : '○ not built',
      }));
      head.appendChild(el('span', { style: 'font-weight:600', text: t.name }));
      if (t.version) head.appendChild(el('span', { cls: 'dim mono', style: 'font-size:11px', text: t.version }));
      card.appendChild(head);
      card.appendChild(el('div', { cls: 'mcp-server-cmd', text: t.path }));
      card.appendChild(el('div', { cls: 'dim', style: 'font-size:12px', text: ROLES[t.name] || '' }));

      // ── Per-tool action buttons ────────────────────────────────
      if (t.exists && t.name === 'memora-cli') {
        const actRow = el('div', { cls: 'session-actions', style: 'margin-top:8px' });
        const mcpBtn = el('button', { cls: 'btn btn-sm', text: 'Connect via MCP' });
        mcpBtn.addEventListener('click', () => {
          import('../app.js').then(({ navigateTo }) => {
            if (typeof navigateTo === 'function') {
              navigateTo('settings', { tab: 'connectors', prefill: 'memora' });
            }
          }).catch(() => {});
        });
        actRow.appendChild(mcpBtn);
        card.appendChild(actRow);
      }

      if (t.exists && t.name === 'akmon') {
        const actRow = el('div', { cls: 'session-actions', style: 'margin-top:8px' });
        const delegateBtn = el('button', { cls: 'btn btn-sm', text: 'Delegate a task' });
        delegateBtn.addEventListener('click', () => {
          import('../app.js').then(({ navigateTo }) => {
            if (typeof navigateTo === 'function') {
              navigateTo('sessions');
            }
          }).catch(() => {});
        });
        actRow.appendChild(delegateBtn);
        card.appendChild(actRow);
      }

      grid.appendChild(card);
    }
  } catch (e) {
    showToast(`ecosystem: ${e}`, 'error');
  }
}

/** Unmount. */
export function unmountEcosystem() {
  _mounted = false;
}
