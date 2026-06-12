/**
 * policy.js - Policy contract page (U7).
 *
 * Renders policy.json as a contract document: autonomy ladder, deny/allow
 * commands, network, writable paths, redact keys, max timeout. Right column:
 * last 50 policy.decision events from the buffer.
 *
 * Supports an EDIT MODE (Edit policy button in section header) with:
 *   - autonomy: 3-option radio
 *   - allow_commands/deny_commands/allow_hosts/writable_paths/redact_keys: textareas
 *   - allow_network: checkbox
 *   - max_timeout_s: number input
 *
 * Review changes → shows diff + exact soma CLI commands → Apply N changes.
 *
 * @module views/policy
 */

import { el, fmtTime, kindArea, helpButton } from '../render.js';
import { get, subscribe } from '../state.js';
import { readPolicy, somaRaw } from '../soma.js';
import { showToast } from './toast.js';

let _mounted = false;
let _policy = null;
let _editMode = false;

/**
 * Mount the policy view.
 */
export async function mountPolicy() {
  _mounted = true;
  _editMode = false;
  renderShell();
  await loadPolicy();

  // Re-render enforcement panel when events change
  subscribe('events', () => { if (_mounted) renderEnforcement(); });
}

/**
 * Unmount.
 */
export function unmountPolicy() {
  _mounted = false;
  _editMode = false;
}

async function loadPolicy() {
  const project = get('currentProject');
  if (!project) return;

  try {
    _policy = await readPolicy(project);
    if (_mounted) renderContract();
  } catch (e) {
    showToast(`read policy: ${e}`, 'error');
    const contractEl = document.getElementById('policy-contract');
    if (contractEl) contractEl.innerHTML = `<div class="dim" style="padding:16px">Failed to load policy.json: ${e}</div>`;
  }
}

function renderShell() {
  const container = document.getElementById('view-container');
  if (!container) return;
  container.innerHTML = '';

  const hdr = el('div', { cls: 'section-header' });
  hdr.appendChild(el('h2', { cls: 'section-title', text: 'Policy' }));
  hdr.appendChild(helpButton('Policy', [
    'Policy is the written autonomy contract. The autonomy ladder has three rungs: observe (soma only watches), assist (soma prepares proposals, you click Apply), auto (mechanical proposals are applied automatically on each tick). Every rung change is journaled.',
    'The contract also sets deny/allow command patterns, network egress rules (local-only = nothing leaves the machine; hybrid = allowlisted hosts only), writable paths, redact keys (stripped before the journal), and max timeout.',
    'Edit policy with the Edit policy button - review the diff and the exact soma policy set commands before applying. The right column shows the last 50 policy decisions from the live journal.',
  ]));

  const hdrBtns = el('div', { style: 'display:flex;gap:8px;align-items:center' });
  const refreshBtn = el('button', { cls: 'btn', text: '↻ Refresh' });
  refreshBtn.addEventListener('click', () => loadPolicy());
  hdrBtns.appendChild(refreshBtn);

  const editBtn = el('button', { cls: 'btn', id: 'policy-edit-btn', text: 'Edit policy' });
  editBtn.addEventListener('click', () => enterEditMode());
  hdrBtns.appendChild(editBtn);

  hdr.appendChild(hdrBtns);
  container.appendChild(hdr);

  const layout = el('div', { cls: 'policy-layout' });
  layout.appendChild(el('div', { id: 'policy-contract', cls: 'policy-contract' }));
  layout.appendChild(el('div', { id: 'policy-enforcement', cls: 'enforcement-panel' }));
  container.appendChild(layout);

  renderEnforcement();
}

function renderContract() {
  const contractEl = document.getElementById('policy-contract');
  if (!contractEl || !_policy) return;
  contractEl.innerHTML = '';

  const p = _policy;

  contractEl.appendChild(el('div', { cls: 'contract-title', text: 'The autonomy contract' }));

  // ── Autonomy ladder ──────────────────────────────────────────
  const RUNGS = [
    { id: 'observe', label: 'observe', meaning: 'Read-only: soma watches and journals but never acts.' },
    { id: 'assist',  label: 'assist',  meaning: 'Human applies proposals from the inbox - every action is requested, not automatic.' },
    { id: 'auto',    label: 'auto',    meaning: 'Mechanical proposals are applied automatically on each tick; soma acts without asking.' },
  ];
  const current = p.autonomy || 'assist';
  const ladder = el('div', { cls: 'autonomy-ladder' });
  for (const rung of RUNGS) {
    const isCurrent = rung.id === current;
    const row = el('div', { cls: `ladder-rung${isCurrent ? ' current' : ''}` });
    row.appendChild(el('span', { cls: 'rung-label', text: rung.label }));
    row.appendChild(el('span', { cls: 'rung-meaning', text: rung.meaning }));
    if (isCurrent) row.appendChild(el('span', { cls: 'chip chip-blue', style: 'margin-left:auto;font-size:9px', text: 'current' }));
    ladder.appendChild(row);
  }
  contractEl.appendChild(ladder);

  // ── Deny commands ─────────────────────────────────────────────
  if (p.deny_commands && p.deny_commands.length > 0) {
    const section = el('div', { cls: 'policy-section' });
    section.appendChild(el('div', { cls: 'policy-section-title', text: 'Deny patterns' }));
    const chips = el('div', { cls: 'chip-list' });
    for (const cmd of p.deny_commands) {
      chips.appendChild(el('span', { cls: 'chip chip-red mono', text: cmd }));
    }
    section.appendChild(chips);
    contractEl.appendChild(section);
  }

  // ── Allow commands ────────────────────────────────────────────
  if (p.allow_commands && p.allow_commands.length > 0) {
    const section = el('div', { cls: 'policy-section' });
    section.appendChild(el('div', { cls: 'policy-section-title', text: 'Allow patterns' }));
    const chips = el('div', { cls: 'chip-list' });
    for (const cmd of p.allow_commands) {
      chips.appendChild(el('span', { cls: 'chip chip-green mono', text: cmd }));
    }
    section.appendChild(chips);
    contractEl.appendChild(section);
  }

  // ── Network ───────────────────────────────────────────────────
  // policy.json shape: top-level allow_network + allow_hosts (network:{} is
  // the status --json shape - they are not the same).
  const net = { allow: p.allow_network === true, hosts: p.allow_hosts || [] };
  {
    const section = el('div', { cls: 'policy-section' });
    section.appendChild(el('div', { cls: 'policy-section-title', text: 'Network' }));
    if (!net.allow) {
      section.appendChild(el('span', { cls: 'chip chip-green', text: 'LOCAL-ONLY - no egress' }));
    } else {
      const hosts = (net.hosts || []).join(', ') || 'on';
      const row = el('div');
      row.appendChild(el('span', { cls: 'chip chip-amber', text: `hybrid` }));
      row.appendChild(el('span', { cls: 'dim', style: 'font-size:11px;margin-left:6px', text: `hosts: ${hosts}` }));
      section.appendChild(row);
    }
    contractEl.appendChild(section);
  }

  // ── Writable paths ────────────────────────────────────────────
  if (p.writable_paths && p.writable_paths.length > 0) {
    const section = el('div', { cls: 'policy-section' });
    section.appendChild(el('div', { cls: 'policy-section-title', text: 'Writable paths' }));
    const chips = el('div', { cls: 'chip-list' });
    for (const path of p.writable_paths) {
      chips.appendChild(el('span', { cls: 'chip chip-gray mono', text: path }));
    }
    section.appendChild(chips);
    contractEl.appendChild(section);
  }

  // ── Redact keys ───────────────────────────────────────────────
  if (p.redact_keys && p.redact_keys.length > 0) {
    const section = el('div', { cls: 'policy-section' });
    section.appendChild(el('div', { cls: 'policy-section-title', text: 'Redact keys' }));
    const chips = el('div', { cls: 'chip-list' });
    for (const key of p.redact_keys) {
      chips.appendChild(el('span', { cls: 'chip chip-amber mono', text: key }));
    }
    section.appendChild(chips);
    section.appendChild(el('div', { cls: 'dim', style: 'font-size:10px;margin-top:4px', text: 'Applied before anything reaches the journal.' }));
    contractEl.appendChild(section);
  }

  // ── Max timeout ───────────────────────────────────────────────
  if (p.max_timeout_s !== undefined && p.max_timeout_s !== null) {
    const section = el('div', { cls: 'policy-section' });
    section.appendChild(el('div', { cls: 'policy-section-title', text: 'Max timeout' }));
    section.appendChild(el('span', { cls: 'mono', text: `${p.max_timeout_s}s` }));
    contractEl.appendChild(section);
  }

  // ── Read-only footer ──────────────────────────────────────────
  contractEl.appendChild(el('div', {
    cls: 'dim',
    style: 'font-size:10px;margin-top:16px;padding-top:10px;border-top:1px solid var(--border)',
    text: 'Edit .soma/policy.json in your editor - the contract is reviewed like code. Presets via the wizard.',
  }));
}

/**
 * Render the enforcement panel (last 50 policy.decision events).
 */
function renderEnforcement() {
  const panel = document.getElementById('policy-enforcement');
  if (!panel) return;
  panel.innerHTML = '';

  panel.appendChild(el('div', { cls: 'enforcement-title', text: 'Enforcement' }));

  const events = get('events') || [];
  const decisions = events
    .filter(ev => ev.kind === 'policy.decision')
    .slice(0, 50);

  if (decisions.length === 0) {
    panel.appendChild(el('div', { cls: 'dim', style: 'font-size:12px;padding:8px 0', text: 'No policy decisions in loaded buffer.' }));
    return;
  }

  const list = el('div', { cls: 'enforcement-list' });
  for (const ev of decisions) {
    const d = ev.data || ev;
    // Journal shape: {subject, allowed, rule}
    const allowed = (d.allowed !== undefined ? d.allowed : d.allow) === true;
    const row = el('div', { cls: `enforcement-row${allowed ? ' allow-row' : ' deny-row'}` });

    row.appendChild(el('span', { cls: 'enf-time', text: fmtTime(ev.t || ev.ts) }));
    row.appendChild(el('span', { cls: `chip ${allowed ? 'chip-green' : 'chip-red'}`, style: 'font-size:9px', text: allowed ? 'ALLOW' : 'DENY' }));
    if (d.rule || d.pattern) {
      row.appendChild(el('span', { cls: 'enf-rule', text: d.rule || d.pattern }));
    }
    const subject = d.subject || d.action;
    if (subject) {
      row.appendChild(el('span', { cls: 'enf-action', title: subject, text: subject }));
    }
    list.appendChild(row);
  }
  panel.appendChild(list);
}

// ── Edit mode ─────────────────────────────────────────────────────────

const AUTONOMY_RUNGS = [
  { id: 'observe', label: 'observe', meaning: 'Read-only: soma watches and journals but never acts.' },
  { id: 'assist',  label: 'assist',  meaning: 'Human applies proposals - every action is requested.' },
  { id: 'auto',    label: 'auto',    meaning: 'Mechanical proposals applied automatically on each tick.' },
];

/** Normalise a list field from policy (array of strings) to textarea text. */
function listToText(arr) {
  if (!arr || arr.length === 0) return '';
  return arr.join('\n');
}

/** Parse textarea text back to an array of non-empty trimmed lines. */
function textToList(text) {
  return text.split('\n').map(s => s.trim()).filter(s => s.length > 0);
}

function enterEditMode() {
  if (!_policy) return;
  _editMode = true;
  const contractEl = document.getElementById('policy-contract');
  if (!contractEl) return;
  contractEl.innerHTML = '';

  const p = _policy;

  contractEl.appendChild(el('div', { cls: 'contract-title', text: 'Edit policy' }));

  // ── Autonomy radio ────────────────────────────────────────────
  const autonomySection = el('div', { cls: 'policy-section' });
  autonomySection.appendChild(el('div', { cls: 'policy-section-title', text: 'Autonomy' }));
  const radioGroup = el('div', { cls: 'policy-radio-group' });
  for (const rung of AUTONOMY_RUNGS) {
    const label = el('label', { cls: 'policy-radio-label' });
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'edit-autonomy';
    radio.value = rung.id;
    radio.id = `edit-autonomy-${rung.id}`;
    if ((p.autonomy || 'assist') === rung.id) radio.checked = true;
    label.appendChild(radio);
    label.appendChild(el('span', { cls: 'rung-label', text: rung.label }));
    label.appendChild(el('span', { cls: 'rung-meaning dim', text: ` - ${rung.meaning}` }));
    radioGroup.appendChild(label);
  }
  autonomySection.appendChild(radioGroup);
  contractEl.appendChild(autonomySection);

  // ── Textarea fields ───────────────────────────────────────────
  const TEXTAREA_FIELDS = [
    { key: 'allow_commands', label: 'Allow patterns (one per line)' },
    { key: 'deny_commands',  label: 'Deny patterns (one per line)' },
    { key: 'allow_hosts',    label: 'Allow hosts (one per line)' },
    { key: 'writable_paths', label: 'Writable paths (one per line)' },
    { key: 'redact_keys',    label: 'Redact keys (one per line)' },
  ];
  for (const { key, label } of TEXTAREA_FIELDS) {
    const section = el('div', { cls: 'policy-section' });
    section.appendChild(el('div', { cls: 'policy-section-title', text: label }));
    const ta = document.createElement('textarea');
    ta.id = `edit-${key}`;
    ta.className = 'policy-edit-textarea mono';
    ta.rows = 4;
    ta.value = listToText(p[key]);
    section.appendChild(ta);
    contractEl.appendChild(section);
  }

  // ── allow_network checkbox ────────────────────────────────────
  const netSection = el('div', { cls: 'policy-section' });
  netSection.appendChild(el('div', { cls: 'policy-section-title', text: 'Network' }));
  const netLabel = el('label', { cls: 'policy-checkbox-label' });
  const netCb = document.createElement('input');
  netCb.type = 'checkbox';
  netCb.id = 'edit-allow_network';
  netCb.checked = !!p.allow_network;
  netLabel.appendChild(netCb);
  netLabel.appendChild(el('span', { text: ' Allow outbound network (allow_network)' }));
  netSection.appendChild(netLabel);
  contractEl.appendChild(netSection);

  // ── max_timeout_s number input ────────────────────────────────
  const tmSection = el('div', { cls: 'policy-section' });
  tmSection.appendChild(el('div', { cls: 'policy-section-title', text: 'Max timeout (seconds)' }));
  const tmInput = document.createElement('input');
  tmInput.type = 'number';
  tmInput.id = 'edit-max_timeout_s';
  tmInput.className = 'policy-edit-number';
  tmInput.min = '1';
  tmInput.value = p.max_timeout_s !== undefined ? String(p.max_timeout_s) : '600';
  tmSection.appendChild(tmInput);
  contractEl.appendChild(tmSection);

  // ── Action buttons ────────────────────────────────────────────
  const actionRow = el('div', { cls: 'policy-edit-actions' });

  const reviewBtn = el('button', { cls: 'btn', id: 'policy-review-btn', text: 'Review changes →' });
  reviewBtn.addEventListener('click', () => showReview());
  actionRow.appendChild(reviewBtn);

  const cancelBtn = el('button', { cls: 'btn', text: 'Cancel' });
  cancelBtn.addEventListener('click', () => exitEditMode());
  actionRow.appendChild(cancelBtn);

  contractEl.appendChild(actionRow);
}

function exitEditMode() {
  _editMode = false;
  if (_mounted) renderContract();
}

/** Read current values from the edit form and return a plain object. */
function readEditForm() {
  const autonomyRadio = document.querySelector('input[name="edit-autonomy"]:checked');
  const autonomy = autonomyRadio ? autonomyRadio.value : (_policy.autonomy || 'assist');

  const readTA = (key) => textToList(
    (document.getElementById(`edit-${key}`) || { value: '' }).value
  );
  const netCb = document.getElementById('edit-allow_network');
  const tmInput = document.getElementById('edit-max_timeout_s');

  return {
    autonomy,
    allow_commands: readTA('allow_commands'),
    deny_commands:  readTA('deny_commands'),
    allow_hosts:    readTA('allow_hosts'),
    writable_paths: readTA('writable_paths'),
    redact_keys:    readTA('redact_keys'),
    allow_network:  netCb ? netCb.checked : !!_policy.allow_network,
    max_timeout_s:  tmInput ? parseInt(tmInput.value, 10) : _policy.max_timeout_s,
  };
}

/** Deep equality check for policy field values. */
function fieldEqual(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  return a === b;
}

/** Compute diff between original policy and edited values.
 *  Returns array of { field, old, new } for changed fields only.
 */
function computeDiff(edited) {
  const fields = [
    'autonomy',
    'allow_commands',
    'deny_commands',
    'allow_network',
    'allow_hosts',
    'writable_paths',
    'redact_keys',
    'max_timeout_s',
  ];
  const changes = [];
  for (const field of fields) {
    const oldVal = _policy[field];
    const newVal = edited[field];
    if (!fieldEqual(oldVal, newVal)) {
      changes.push({ field, old: oldVal, new: newVal });
    }
  }
  return changes;
}

/** Format a policy value for display (compact). */
function fmtVal(v) {
  if (Array.isArray(v)) return JSON.stringify(v);
  if (typeof v === 'boolean') return String(v);
  return String(v);
}

function showReview() {
  const edited = readEditForm();
  const changes = computeDiff(edited);

  const contractEl = document.getElementById('policy-contract');
  if (!contractEl) return;
  contractEl.innerHTML = '';

  contractEl.appendChild(el('div', { cls: 'contract-title', text: 'Review changes' }));

  if (changes.length === 0) {
    contractEl.appendChild(el('div', { cls: 'dim', style: 'padding:12px 0', text: 'No changes detected.' }));
    const backRow = el('div', { cls: 'policy-edit-actions' });
    const backBtn = el('button', { cls: 'btn', text: '← Back' });
    backBtn.addEventListener('click', () => enterEditMode());
    backRow.appendChild(backBtn);
    const cancelBtn = el('button', { cls: 'btn', text: 'Cancel' });
    cancelBtn.addEventListener('click', () => exitEditMode());
    backRow.appendChild(cancelBtn);
    contractEl.appendChild(backRow);
    return;
  }

  // ── Diff table ────────────────────────────────────────────────
  const diffSection = el('div', { cls: 'policy-diff-section' });
  diffSection.appendChild(el('div', { cls: 'policy-section-title', text: `${changes.length} field${changes.length === 1 ? '' : 's'} changed` }));
  for (const ch of changes) {
    const row = el('div', { cls: 'policy-diff-row' });
    row.appendChild(el('span', { cls: 'policy-diff-field mono', text: ch.field }));
    const vals = el('div', { cls: 'policy-diff-vals' });
    vals.appendChild(el('div', { cls: 'policy-diff-old mono', text: `− ${fmtVal(ch.old)}` }));
    vals.appendChild(el('div', { cls: 'policy-diff-new mono', text: `+ ${fmtVal(ch.new)}` }));
    row.appendChild(vals);
    diffSection.appendChild(row);
  }
  contractEl.appendChild(diffSection);

  // ── Exact commands preview ────────────────────────────────────
  const cmdSection = el('div', { cls: 'policy-section' });
  cmdSection.appendChild(el('div', { cls: 'policy-section-title', text: 'Commands to run' }));
  const cmdList = el('div', { cls: 'policy-cmd-list' });
  for (const ch of changes) {
    const line = `soma policy set ${ch.field} ${JSON.stringify(ch.new)}`;
    cmdList.appendChild(el('div', { cls: 'policy-cmd-line mono', text: line }));
  }
  cmdSection.appendChild(cmdList);
  contractEl.appendChild(cmdSection);

  // ── Apply + back + cancel buttons ────────────────────────────
  const actionRow = el('div', { cls: 'policy-edit-actions' });

  const applyBtn = el('button', { cls: 'btn btn-apply', id: 'policy-apply-btn', text: `Apply ${changes.length} change${changes.length === 1 ? '' : 's'}` });
  applyBtn.addEventListener('click', () => applyChanges(changes));
  actionRow.appendChild(applyBtn);

  const backBtn = el('button', { cls: 'btn', text: '← Back' });
  backBtn.addEventListener('click', () => enterEditMode());
  actionRow.appendChild(backBtn);

  const cancelBtn = el('button', { cls: 'btn', text: 'Cancel' });
  cancelBtn.addEventListener('click', () => exitEditMode());
  actionRow.appendChild(cancelBtn);

  contractEl.appendChild(actionRow);
}

async function applyChanges(changes) {
  const project = get('currentProject');
  if (!project) return;

  const applyBtn = document.getElementById('policy-apply-btn');
  if (applyBtn) {
    applyBtn.disabled = true;
    applyBtn.textContent = 'Applying…';
  }

  for (const ch of changes) {
    const result = await somaRaw(['policy', 'set', ch.field, JSON.stringify(ch.new)], project);
    if (result.code !== 0) {
      showToast(`policy set ${ch.field}: ${result.stderr || `exit ${result.code}`}`, 'error');
      if (applyBtn) { applyBtn.disabled = false; applyBtn.textContent = `Retry`; }
      return;
    }
    showToast((result.stdout || `policy: ${ch.field} updated`).trim(), 'info');
  }

  // Reload read-only view + trigger poll
  _editMode = false;
  await loadPolicy();
  try {
    const { triggerPollAndVerify } = await import('../app.js');
    triggerPollAndVerify();
  } catch (_) { /* app.js may not export this in all builds */ }
}
