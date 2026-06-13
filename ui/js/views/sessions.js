/**
 * sessions.js - Conductor board (v3, UI-SPEC §8b).
 *
 * akmon sessions as first-class objects: "soma decided → akmon executed →
 * evidence captured." Cards come from the host's read-only scan of
 * .akmon/evidence/*.json + .akmon/audit/*.jsonl; actions route through
 * soma skills (akmon-task, akmon-bundle-export) so every run stays
 * policy-gated and journaled.
 *
 * @module views/sessions
 */

import { el, fmtTime, helpButton } from '../render.js';
import { get } from '../state.js';
import { listAkmonSessions } from '../soma.js';
import { showToast } from './toast.js';
import { isRunning, startRun } from './console.js';
import { formModal, field } from './modal.js';

let _mounted = false;
let _sessions = [];

/** Mount the Sessions board into #view-container. */
export async function mountSessions() {
  _mounted = true;
  renderShell();
  await loadSessions();
}

/** Unmount. */
export function unmountSessions() {
  _mounted = false;
}

async function loadSessions() {
  const project = get('currentProject');
  if (!project) return;
  try {
    _sessions = (await listAkmonSessions(project)) || [];
    if (_mounted) renderCards();
  } catch (e) {
    showToast(`sessions: ${e}`, 'error');
    if (_mounted) renderCards();
  }
}

function renderShell() {
  const container = document.getElementById('view-container');
  if (!container) return;
  container.innerHTML = '';

  const header = el('div', { cls: 'section-header' });
  header.appendChild(el('h2', { cls: 'section-title', text: 'Sessions - conductor' }));
  header.appendChild(helpButton('Sessions', [
    'Sessions are full akmon agent runs delegated from soma. The conductor pattern: soma decides and policy-gates, akmon executes and produces a signed AGEF evidence bundle.',
    'Each card shows the chain-validity badge (⛓), the model used, tool-call counts, and policy allow/deny tallies from the evidence file. A red badge means the audit chain is broken.',
    'Delegate a task below - soma runs the akmon-task skill, which is policy-gated, journaled, and produces evidence. Export any session as an AGEF bundle to hand to an auditor.',
  ]));
  const governBtn = el('button', { cls: 'btn btn-green', text: '▶ Govern a command' });
  governBtn.addEventListener('click', () => openGovernModal());
  header.appendChild(governBtn);
  const refreshBtn = el('button', { cls: 'btn', text: '↻ Refresh' });
  refreshBtn.addEventListener('click', () => loadSessions());
  header.appendChild(refreshBtn);
  container.appendChild(header);

  // Delegate form: soma selects/gates/journals; akmon executes one session.
  const form = el('div', { cls: 'delegate-form' });
  form.appendChild(el('div', { cls: 'delegate-label', text: 'Delegate a task to akmon (runs the akmon-task skill - policy-gated, journaled, evidence captured):' }));
  const row = el('div', { cls: 'delegate-row' });
  const input = el('input', { cls: 'delegate-input', type: 'text', placeholder: 'e.g. Summarize what this repository does in two sentences.' });
  const btn = el('button', { cls: 'btn btn-green', text: '▶ Delegate' });
  btn.addEventListener('click', async () => {
    const task = input.value.trim();
    if (!task) { showToast('enter a task to delegate', 'error'); return; }
    if (isRunning()) { showToast('a run is already in progress', 'error'); return; }
    btn.disabled = true;
    await startRun('delegate to akmon', ['skill', 'run', 'akmon-task', task], get('currentProject'), {
      onDone: () => { btn.disabled = false; loadSessions(); import('../app.js').then(({ triggerPollAndVerify }) => triggerPollAndVerify && triggerPollAndVerify()); },
    });
  });
  row.appendChild(input);
  row.appendChild(btn);
  form.appendChild(row);
  container.appendChild(form);

  container.appendChild(el('div', { id: 'sessions-list', cls: 'sessions-list' }));
}

/**
 * Quote a value for the command preview if it contains shell-significant
 * characters or is empty. Display-only - the real argv is passed as a single
 * argument to `sh -c`, never re-split.
 * @param {string} s
 * @returns {string}
 */
function q(s) {
  if (s === '' || /[\s"'`$;|&<>(){}*?\\]/.test(s)) return `'${s.replace(/'/g, `'\\''`)}'`;
  return s;
}

/**
 * Open the "Govern a command" modal - runs soma's flagship `soma wrap`, which
 * policy-gates the spawn (autonomy + command deny globs), tees stdout/stderr
 * live, and journals wrap.start/wrap.end receipts. The child command is run
 * via `sh -c` so quotes/pipes survive and the deny gate sees the full line.
 */
function openGovernModal() {
  const project = get('currentProject');
  if (!project) { showToast('open a project first', 'error'); return; }
  if (isRunning()) { showToast('a run is already in progress', 'error'); return; }

  const cmdInput = /** @type {HTMLTextAreaElement} */ (
    el('textarea', { cls: 'govern-cmd-input', rows: '2', placeholder: 'e.g. claude -p "fix the failing tests"  or  cargo test' })
  );
  const labelInput = /** @type {HTMLInputElement} */ (
    el('input', { type: 'text', placeholder: 'ui', value: 'ui' })
  );
  const timeoutInput = /** @type {HTMLInputElement} */ (
    el('input', { type: 'number', min: '1', placeholder: 'none' })
  );

  /**
   * Build the soma argv. Everything after `--` is the child command, verbatim;
   * we wrap it in `sh -c <command>` so the user's quotes/pipes are preserved and
   * the deny-glob gate (check_command) still sees the full joined child line.
   * @returns {string[]}
   */
  function buildArgs() {
    const command = cmdInput.value.trim();
    const label = labelInput.value.trim() || 'ui';
    const t = parseInt(timeoutInput.value.trim(), 10);
    /** @type {string[]} */
    const args = ['wrap', '--label', label];
    if (Number.isFinite(t) && t > 0) args.push('--timeout-s', String(t));
    args.push('--', 'sh', '-c', command);
    return args;
  }

  formModal({
    title: 'Govern a command',
    fields: [
      field('Command', cmdInput, 'Runs under this project policy via sh -c, and is journaled (wrap.start / wrap.end). The deny-glob gate sees the full command line.'),
      field('Label (optional)', labelInput, 'Tags the wrap receipts.'),
      field('Timeout seconds (optional)', timeoutInput, 'Kills the child after N seconds (exit 124).'),
    ],
    commandPreview: () => {
      const command = cmdInput.value.trim();
      const label = labelInput.value.trim() || 'ui';
      const t = parseInt(timeoutInput.value.trim(), 10);
      let cmd = `soma wrap --label ${q(label)}`;
      if (Number.isFinite(t) && t > 0) cmd += ` --timeout-s ${t}`;
      cmd += ` -- sh -c ${q(command || '<command>')}`;
      return cmd;
    },
    confirmLabel: '▶ Govern',
    onConfirm: async () => {
      const command = cmdInput.value.trim();
      if (!command) { showToast('enter a command to govern', 'error'); return false; }
      if (isRunning()) { showToast('a run is already in progress', 'error'); return false; }
      const args = buildArgs();
      // Stream the governed run live in the console; never throw on non-zero -
      // surface the exit code honestly via the console pill and a toast.
      startRun('govern a command', args, project, {
        onDone: (code) => {
          if (code === 0) {
            showToast('governed run finished (exit 0) - wrap receipts journaled', 'success');
          } else {
            showToast(`governed run exited ${code} - see the stream above`, 'error');
          }
          loadSessions();
          import('../app.js').then(({ triggerPollAndVerify }) => triggerPollAndVerify && triggerPollAndVerify());
        },
      });
      return true;
    },
  });
}

function renderCards() {
  const list = document.getElementById('sessions-list');
  if (!list) return;
  list.innerHTML = '';

  if (_sessions.length === 0) {
    const empty = el('div', { cls: 'empty-state' });
    empty.appendChild(el('div', { text: 'Delegate a task to akmon below - it will run, produce evidence, and appear here.' }));
    const focusBtn = el('button', { cls: 'btn empty-state-action', text: 'Delegate a task' });
    focusBtn.addEventListener('click', () => {
      const inp = /** @type {HTMLInputElement|null} */ (document.querySelector('.delegate-input'));
      if (inp) inp.focus();
    });
    empty.appendChild(focusBtn);
    list.appendChild(empty);
    return;
  }

  for (const s of _sessions) {
    list.appendChild(sessionCard(s));
  }
}

/**
 * @param {{sid:string, mtime:number, evidence:string|null, audit_bytes:number}} s
 */
function sessionCard(s) {
  /** @type {object|null} */
  let ev = null;
  if (s.evidence) {
    try { ev = JSON.parse(s.evidence); } catch (_) { /* render raw below */ }
  }

  const card = el('div', { cls: 'session-card' });

  // evidence.v1 schema: {session_id, generated_at, replay_metadata,
  // audit{audit_chain_valid, session_final_hash}, policy{allow,deny,prompted},
  // tools{total,success,failure}}
  const head = el('div', { cls: 'session-head' });
  const chainOk = !!(ev && ev.audit && ev.audit.audit_chain_valid === true);
  head.appendChild(el('span', {
    cls: `chip ${ev ? (chainOk ? 'chip-ok' : 'chip-fail') : 'chip-fail'}`,
    text: ev ? (chainOk ? '⛓ chain valid' : '⛓ chain INVALID') : 'no evidence',
  }));
  head.appendChild(el('span', { cls: 'mono session-sid', text: s.sid.slice(0, 8) }));
  head.appendChild(el('span', { cls: 'dim', style: 'font-size:11px', text: fmtTime(s.mtime) }));
  card.appendChild(head);

  if (ev) {
    const meta = el('div', { cls: 'session-meta' });
    const mm = ev.replay_metadata || {};
    if (mm.provider_name || mm.model_id) {
      meta.appendChild(el('span', { cls: 'chip chip-gray', text: `${mm.provider_name || '?'}/${mm.model_id || '?'}` }));
    }
    const t = ev.tools || {};
    if (typeof t.total === 'number') {
      meta.appendChild(el('span', { cls: 'dim', style: 'font-size:11px', text: `${t.total} tool call${t.total === 1 ? '' : 's'} (${t.success || 0} ok)` }));
    }
    const p = ev.policy || {};
    if (typeof p.allow === 'number' || typeof p.deny === 'number') {
      meta.appendChild(el('span', { cls: 'dim', style: 'font-size:11px', text: `policy ${p.allow || 0} allow / ${p.deny || 0} deny` }));
    }
    if (s.audit_bytes > 0) {
      meta.appendChild(el('span', { cls: 'dim', style: 'font-size:11px', text: `audit ${(s.audit_bytes / 1024).toFixed(1)} KB` }));
    }
    card.appendChild(meta);

    const fh = ev.audit && ev.audit.session_final_hash;
    if (fh) {
      card.appendChild(el('div', { cls: 'dim mono', style: 'font-size:10px', text: `final hash ${String(fh).slice(0, 12)}…${String(fh).slice(-6)}` }));
    }
  } else {
    card.appendChild(el('div', {
      cls: 'dim', style: 'font-size:11px',
      text: `no evidence file - session failed before completion (audit ${(s.audit_bytes / 1024).toFixed(1)} KB)`,
    }));
  }

  const actions = el('div', { cls: 'session-actions' });
  const exportBtn = el('button', { cls: 'btn btn-sm', text: '⬡ Export AGEF bundle' });
  exportBtn.addEventListener('click', async () => {
    if (isRunning()) { showToast('a run is already in progress', 'error'); return; }
    exportBtn.disabled = true;
    await startRun('export session bundle', ['skill', 'run', 'akmon-bundle-export', s.sid], get('currentProject'), {
      onDone: (code) => {
        exportBtn.disabled = false;
        if (code === 0) showToast(`bundle exported: exports/akmon-${s.sid.slice(0, 8)}….akmon`, 'success');
        import('../app.js').then(({ triggerPollAndVerify }) => triggerPollAndVerify && triggerPollAndVerify());
      },
    });
  });
  actions.appendChild(exportBtn);
  card.appendChild(actions);

  return card;
}
