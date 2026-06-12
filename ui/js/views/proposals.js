/**
 * proposals.js - Proposals inbox (U6).
 *
 * Apply / Dismiss buttons, auto-apply banner, history section,
 * toast with verbatim binary output, trigger timeline re-verify.
 *
 * @module views/proposals
 */

import { el, fmtTime, rawJsonDetails, helpButton } from '../render.js';
import { get, setState, subscribe } from '../state.js';
import { proposalsList, proposalsListAll } from '../soma.js';
import { showToast } from './toast.js';

let _mounted = false;

/**
 * Mount the proposals view.
 */
export async function mountProposals() {
  _mounted = true;
  renderShell();
  await loadProposals();
}

/**
 * Unmount.
 */
export function unmountProposals() {
  _mounted = false;
}

async function loadProposals() {
  const project = get('currentProject');
  if (!project) return;

  try {
    const [open, all] = await Promise.allSettled([
      proposalsList(project),
      proposalsListAll(project),
    ]);
    if (open.status === 'fulfilled') setState({ proposals: open.value || [] });
    if (all.status  === 'fulfilled') setState({ proposalsAll: all.value || [] });
    if (open.status === 'rejected') showToast(`proposals list: ${open.reason}`, 'error');
    if (_mounted) renderProposals();
  } catch (e) {
    showToast(`proposals: ${e}`, 'error');
  }
}

function renderShell() {
  const container = document.getElementById('view-container');
  if (!container) return;
  container.innerHTML = '';

  const header = el('div', { cls: 'section-header' });
  header.appendChild(el('h2', { cls: 'section-title', text: 'Inbox' }));
  header.appendChild(helpButton('Inbox', [
    'The Inbox shows proposals - changes soma wants to make (skill repairs, config tweaks, cron additions) with a model-written rationale and diff. Nothing is applied until you click Apply.',
    'At assist level (the default) you hold the handbrake: every proposal waits here. At auto level, mechanical proposals are applied automatically on each tick - the auto-apply banner warns you when that is active.',
    'Apply or Dismiss a proposal to move it to History. Every decision is policy-gated and lands in the Timeline immediately. Run a skill to give soma material for new proposals.',
  ]));
  const refreshBtn = el('button', { cls: 'btn', text: '↻ Refresh' });
  refreshBtn.addEventListener('click', () => loadProposals());
  header.appendChild(refreshBtn);
  container.appendChild(header);

  container.appendChild(el('div', { id: 'proposals-body' }));
}

function renderProposals() {
  const body = document.getElementById('proposals-body');
  if (!body) return;
  body.innerHTML = '';

  const proposals    = get('proposals')    || [];
  const proposalsAll = get('proposalsAll') || [];
  const status       = get('status');

  // Auto-banner
  if (status && status.autonomy === 'auto') {
    body.appendChild(el('div', {
      cls: 'auto-banner',
      text: '⚠ autonomy: auto - soma tick auto-applies mechanical proposals without asking',
    }));
  }

  // Open proposals
  if (proposals.length === 0) {
    const empty = el('div', { cls: 'empty-state' });
    empty.appendChild(el('div', { text: 'Proposals appear when soma notices something fixable - run a skill to give it material.' }));
    body.appendChild(empty);
  } else {
    const openTitle = el('div', { cls: 'proposal-section-title', text: `Open (${proposals.length})` });
    body.appendChild(openTitle);
    const list = el('div', { cls: 'proposals-list' });
    for (const p of proposals) list.appendChild(renderProposalCard(p, true));
    body.appendChild(list);
  }

  // History (applied + dismissed from --all)
  const history = proposalsAll.filter(p => p.status !== 'proposed' && p.status !== 'open');
  if (history.length > 0) {
    body.appendChild(el('div', { cls: 'proposal-section-title', text: `History (${history.length})` }));
    const histList = el('div', { cls: 'proposals-list' });
    for (const p of history) histList.appendChild(renderProposalCard(p, false));
    body.appendChild(histList);
  }
}

/**
 * @param {object} p - proposal object
 * @param {boolean} showActions - whether to show Apply/Dismiss buttons
 * @returns {HTMLElement}
 */
function renderProposalCard(p, showActions) {
  const card = el('div', { cls: 'proposal-card' });

  const hdr = el('div', { cls: 'proposal-header' });
  const titleStr = p.kind ? `${p.kind}${p.target ? ` on ${p.target}` : ''}` : (p.id || '?');
  hdr.appendChild(el('div', { cls: 'proposal-title', text: titleStr }));

  const badges = el('div', { cls: 'proposal-badges' });
  const statusCls = { proposed: 'chip-blue', open: 'chip-blue', applied: 'chip-green', dismissed: 'chip-gray' }[p.status] || 'chip-gray';
  badges.appendChild(el('span', { cls: `chip ${statusCls}`, text: p.status || '?' }));
  if (p.kind) badges.appendChild(el('span', { cls: 'chip chip-gray', text: p.kind }));
  // Records carry no `mechanical` field - derive it from the kind (the
  // runtime's MECHANICAL set; fix_skill is model-drafted, NOT mechanical).
  const MECHANICAL = ['tune_timeout', 'add_cron', 'config_change', 'archive_skill'];
  if (p.kind) {
    const mech = MECHANICAL.includes(p.kind);
    badges.appendChild(el('span', { cls: `chip ${mech ? 'chip-amber' : 'chip-gray'}`, text: mech ? 'mechanical' : 'advisory' }));
  }
  hdr.appendChild(badges);
  card.appendChild(hdr);

  // Created time - records carry ts (ms) + iso.
  if (p.iso || p.ts) {
    card.appendChild(el('div', { cls: 'dim', style: 'font-size:11px;margin-bottom:6px', text: fmtTime(p.iso || p.ts) }));
  }

  // Rationale
  if (p.rationale) {
    card.appendChild(el('blockquote', { cls: 'proposal-rationale', text: p.rationale }));
  }

  // Diff/change JSON
  const change = p.change || p.diff || p.data;
  if (change) {
    const diffWrap = el('div', { cls: 'proposal-diff' });
    diffWrap.appendChild(rawJsonDetails(change, 'Change / diff'));
    card.appendChild(diffWrap);
  }

  // Action buttons (open proposals only)
  if (showActions && (p.status === 'proposed' || p.status === 'open')) {
    const actions = el('div', { cls: 'proposal-actions' });

    const applyBtn = el('button', { cls: 'btn btn-green', text: 'Apply' });
    applyBtn.addEventListener('click', () => handleApply(p.id, applyBtn, dismissBtn));

    const dismissBtn = el('button', { cls: 'btn btn-red', text: 'Dismiss' });
    dismissBtn.addEventListener('click', () => handleDismiss(p.id, applyBtn, dismissBtn));

    actions.appendChild(applyBtn);
    actions.appendChild(dismissBtn);
    card.appendChild(actions);
  }

  return card;
}

async function handleApply(id, applyBtn, dismissBtn) {
  if (!id) return;
  const project = get('currentProject');
  setButtonsDisabled(applyBtn, dismissBtn, true);

  try {
    // Use somaRaw to get verbatim stdout+stderr for toast regardless of exit code
    const { somaRaw: raw } = await import('../soma.js');
    const result = await raw(['proposals', 'apply', id, '--json'], project);
    const toastMsg = result.code === 0
      ? (result.stdout.trim() || `Proposal ${id} applied.`)
      : (result.stderr.trim() || `soma exited ${result.code}`);
    showToast(toastMsg, result.code === 0 ? 'success' : 'error');

    if (result.code === 0) {
      // Refresh proposals + trigger timeline poll + re-verify immediately
      await loadProposals();
      triggerImmediatePollAndVerify();
    } else {
      setButtonsDisabled(applyBtn, dismissBtn, false);
    }
  } catch (e) {
    showToast(String(e), 'error');
    setButtonsDisabled(applyBtn, dismissBtn, false);
  }
}

async function handleDismiss(id, applyBtn, dismissBtn) {
  if (!id) return;
  const project = get('currentProject');
  setButtonsDisabled(applyBtn, dismissBtn, true);

  try {
    const { somaRaw: raw } = await import('../soma.js');
    const result = await raw(['proposals', 'dismiss', id, '--json'], project);
    const toastMsg = result.code === 0
      ? (result.stdout.trim() || `Proposal ${id} dismissed.`)
      : (result.stderr.trim() || `soma exited ${result.code}`);
    showToast(toastMsg, result.code === 0 ? 'success' : 'error');

    if (result.code === 0) {
      await loadProposals();
      triggerImmediatePollAndVerify();
    } else {
      setButtonsDisabled(applyBtn, dismissBtn, false);
    }
  } catch (e) {
    showToast(String(e), 'error');
    setButtonsDisabled(applyBtn, dismissBtn, false);
  }
}

function setButtonsDisabled(a, b, disabled) {
  a.disabled = disabled;
  b.disabled = disabled;
}

/**
 * Trigger an immediate timeline poll + badge re-verify.
 * The visible cause→effect loop (U6 core demo).
 */
function triggerImmediatePollAndVerify() {
  // Dynamic import to avoid circular dep (app.js imports proposals.js)
  import('../app.js').then(({ triggerPollAndVerify }) => {
    if (typeof triggerPollAndVerify === 'function') triggerPollAndVerify();
  }).catch(() => {});
}
