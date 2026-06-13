/**
 * skills.js - Skills board (U5) + Skill authoring form (v4, UI-SPEC §8c item 4).
 *
 * Grid of cards from `skill list --json`, with reliability bars,
 * sparklines from timeline buffer, click-to-modal with `skill show`.
 *
 * "+ New skill" section in the header: collapsible form (name, purpose, goal,
 * tags, command, timeout_s, success kind) → live manifest JSON preview →
 * stage_manifest → skill lint / skill add.
 *
 * Skill detail modal: human-first layout per UI-SPEC §9.2 - What it does,
 * How it runs, Track record, Issues, Lineage, collapsed raw JSON.
 *
 * Iron rule: mutations only via soma CLI, exact command shown before running.
 *
 * @module views/skills
 */

import { el, fmtTime, laplace, svgSparkline, rawJsonDetails, cmdPreview, helpButton, eventSummary } from '../render.js';
import { get, subscribe, setState } from '../state.js';
import { skillList, skillShow, somaJson, somaRaw } from '../soma.js';
import { showToast } from './toast.js';
import { isRunning, startRun } from './console.js';
import { formModal, field } from './modal.js';

let _mounted = false;

/**
 * Mount the skills view into #view-container.
 */
export async function mountSkills() {
  _mounted = true;
  renderShell();

  // Refresh skill list
  await loadSkills();
}

/**
 * Unmount.
 */
export function unmountSkills() {
  _mounted = false;
}

async function loadSkills() {
  const project = get('currentProject');
  if (!project) return;
  try {
    const skills = await skillList(project);
    setState({ skills: skills || [] });
    if (_mounted) renderGrid();
  } catch (e) {
    showToast(`skill list: ${e}`, 'error');
    if (_mounted) renderGrid();
  }
}

function renderShell() {
  const container = document.getElementById('view-container');
  if (!container) return;
  container.innerHTML = '';

  const header = el('div', { cls: 'section-header' });
  header.appendChild(el('h2', { cls: 'section-title', text: 'Skills' }));

  const btns = el('div', { cls: 'view-toolbar', style: 'margin:0;gap:8px' });
  const refreshBtn = el('button', { cls: 'btn', text: '↻ Refresh' });
  refreshBtn.addEventListener('click', () => loadSkills());
  btns.appendChild(refreshBtn);

  const newBtn = el('button', { cls: 'btn btn-green', text: '+ New skill' });
  newBtn.addEventListener('click', () => openSkillForm(null));
  btns.appendChild(newBtn);

  // §9.7 help button
  btns.appendChild(helpButton('Skills', [
    'A skill is a single command soma can run, with a success rule and a tracked record. Cards show reliability (Laplace-smoothed) and recent runs. Click a card for the full story; ▶ runs it live in the console.',
    'Create skills with + New skill, or import them from a connector (Settings → Connectors).',
  ]));

  header.appendChild(btns);
  container.appendChild(header);

  container.appendChild(el('div', { id: 'skills-grid', cls: 'skills-grid' }));
}

// ── New / edit skill modal ───────────────────────────────────────

/**
 * @typedef {Object} SkillFormState
 * @property {string} name
 * @property {string} purpose
 * @property {string} goal
 * @property {string} tags
 * @property {string} cmd
 * @property {number} timeout_s
 * @property {string} successKind
 * @property {string} containsText
 * @property {number} version
 */

/**
 * Derive a SkillFormState from an existing manifest (for Edit), or defaults.
 * @param {object|null} manifest
 * @returns {SkillFormState}
 */
function stateFromManifest(manifest) {
  const m = manifest || {};
  const run = m.run || {};
  const success = m.success || {};
  return {
    name: m.name || '',
    purpose: m.purpose || '',
    goal: m.goal || '',
    tags: Array.isArray(m.tags) ? m.tags.join(', ') : (m.tags || ''),
    cmd: run.cmd || '',
    timeout_s: typeof run.timeout_s === 'number' ? run.timeout_s : 60,
    successKind: success.kind === 'contains' ? 'contains' : 'exit0',
    containsText: success.kind === 'contains' ? (success.text || '') : '',
    version: typeof m.version === 'number' ? m.version : 1,
  };
}

/**
 * Build a skill manifest object from a SkillFormState.
 * @param {SkillFormState} s
 * @returns {object}
 */
function buildManifest(s) {
  const tagArr = s.tags.split(',').map(t => t.trim()).filter(Boolean);
  return {
    name: s.name || '<name>',
    version: s.version || 1,
    purpose: s.purpose || '',
    goal: s.goal || '',
    tags: tagArr,
    kind: 'command',
    run: { cmd: s.cmd || '', timeout_s: s.timeout_s || 60 },
    success: s.successKind === 'contains'
      ? { kind: 'contains', text: s.containsText || '' }
      : { kind: 'exit0' },
  };
}

/**
 * Open the shared wizard-styled modal for creating or editing a skill.
 *
 * `skill add` overwrites an existing manifest of the same name in place, so
 * Edit re-stages the manifest and runs `skill add` to save over it (verified
 * against the CLI - no version bump required). When editing, the name field is
 * read-only so the overwrite always targets the same skill.
 *
 * @param {object|null} existingManifest - manifest to edit, or null to create
 */
function openSkillForm(existingManifest) {
  const project = get('currentProject');
  const isEdit = !!existingManifest;
  const s = stateFromManifest(existingManifest);

  const nameInput = /** @type {HTMLInputElement} */ (el('input', { type: 'text', placeholder: 'my-skill', value: s.name }));
  if (isEdit) { nameInput.readOnly = true; nameInput.title = 'Name is fixed when editing.'; }

  const purposeInput = /** @type {HTMLInputElement} */ (el('input', { type: 'text', placeholder: 'One-line what/why', value: s.purpose }));
  const goalInput = /** @type {HTMLInputElement} */ (el('input', { type: 'text', placeholder: 'Desired outcome', value: s.goal }));
  const tagsInput = /** @type {HTMLInputElement} */ (el('input', { type: 'text', placeholder: 'rust, test, ci', value: s.tags }));
  const cmdInput = /** @type {HTMLInputElement} */ (el('input', { type: 'text', placeholder: 'cargo test --workspace', value: s.cmd }));

  const timeoutInput = /** @type {HTMLInputElement} */ (el('input', { type: 'number', value: String(s.timeout_s) }));
  timeoutInput.min = '1';

  const kindSelect = /** @type {HTMLSelectElement} */ (el('select'));
  for (const k of ['exit0', 'contains']) {
    const opt = el('option', { value: k, text: k });
    if (k === s.successKind) opt.selected = true;
    kindSelect.appendChild(opt);
  }

  const containsInput = /** @type {HTMLInputElement} */ (el('input', { type: 'text', placeholder: 'expected output substring', value: s.containsText }));
  const containsField = field('Contains text', containsInput);

  function syncVisibility() {
    containsField.style.display = kindSelect.value === 'contains' ? '' : 'none';
  }
  kindSelect.addEventListener('change', syncVisibility);
  syncVisibility();

  /** @returns {SkillFormState} the current form state */
  function readState() {
    return {
      name: nameInput.value.trim(),
      purpose: purposeInput.value,
      goal: goalInput.value,
      tags: tagsInput.value,
      cmd: cmdInput.value,
      timeout_s: Math.max(1, parseInt(timeoutInput.value, 10) || 60),
      successKind: kindSelect.value,
      containsText: containsInput.value,
      version: s.version,
    };
  }

  // Live manifest JSON preview - collapsed by default so the modal stays the
  // same compact height as the goal/cron modals (footer reachable without
  // scrolling). Expand to inspect the exact JSON that will be staged.
  const manifestPre = el('pre', { cls: 'json-pretty', style: 'margin-top:6px;max-height:200px;overflow:auto' });
  const manifestField = el('details', { cls: 'raw-json wizard-field' });
  manifestField.appendChild(el('summary', { text: 'Manifest JSON' }));
  manifestField.appendChild(manifestPre);

  /** Stage the current manifest and return its path. */
  async function stage() {
    const invoke = window.__TAURI__.core.invoke;
    const content = JSON.stringify(buildManifest(readState()), null, 2);
    return invoke('stage_manifest', { content });
  }

  // Lint as a secondary action in the body (kept from the old form).
  const lintBtn = el('button', { cls: 'btn', text: 'Lint' });
  lintBtn.addEventListener('click', async () => {
    lintBtn.disabled = true;
    const orig = lintBtn.textContent;
    lintBtn.textContent = '…';
    try {
      const path = await stage();
      const result = await somaRaw(['skill', 'lint', path], project);
      const msg = result.stdout.trim() || result.stderr.trim() || `exit ${result.code}`;
      showToast(msg, result.code === 0 ? 'success' : 'error');
    } catch (e) {
      showToast(String(e), 'error');
    } finally {
      lintBtn.disabled = false;
      lintBtn.textContent = orig;
    }
  });
  const lintRow = el('div', { cls: 'wizard-field', style: 'margin-bottom:0' });
  lintRow.appendChild(lintBtn);

  const modal = formModal({
    title: isEdit ? `Edit skill ${s.name}` : 'New skill',
    fields: [
      field('Name', nameInput),
      field('Purpose', purposeInput),
      field('Goal', goalInput),
      field('Tags (comma-separated)', tagsInput),
      field('Command', cmdInput),
      field('Timeout (seconds)', timeoutInput),
      field('Success kind', kindSelect),
      containsField,
      manifestField,
      lintRow,
    ],
    commandPreview: () => {
      // Refresh the manifest JSON preview alongside the command line.
      manifestPre.textContent = JSON.stringify(buildManifest(readState()), null, 2);
      return 'soma skill add <staged-manifest>';
    },
    confirmLabel: isEdit ? 'Save skill' : '+ Add skill',
    onConfirm: async () => {
      const st = readState();
      if (!st.name) { showToast('Name is required.', 'error'); return false; }
      if (!st.cmd) { showToast('Command is required.', 'error'); return false; }
      const path = await stage();
      const result = await somaRaw(['skill', 'add', path], project);
      const msg = result.stdout.trim() || result.stderr.trim() || `exit ${result.code}`;
      showToast(msg, result.code === 0 ? 'success' : 'error');
      if (result.code !== 0) return false;
      await loadSkills();
      triggerPollAndVerify();
      return true;
    },
  });

  // Seed the manifest JSON preview immediately.
  modal.refreshPreview();
}

// ── Grid rendering ───────────────────────────────────────────────

function renderGrid() {
  const gridEl = document.getElementById('skills-grid');
  if (!gridEl) return;
  gridEl.innerHTML = '';

  const skills = get('skills') || [];
  if (skills.length === 0) {
    // §9.7 empty state: title + sentence + two action buttons
    const empty = el('div', { cls: 'empty-state' });
    empty.appendChild(el('div', { cls: 'empty-state-title', text: 'No skills yet' }));
    empty.appendChild(el('div', { cls: 'empty-state-body', text: 'Skills are commands soma can run on your behalf - each tracked, policy-gated, and journaled.' }));

    const actions = el('div', { cls: 'empty-state-actions' });

    const newBtn = el('button', { cls: 'btn btn-green empty-state-action', text: '+ New skill' });
    newBtn.addEventListener('click', () => openSkillForm(null));
    actions.appendChild(newBtn);

    const connBtn = el('button', { cls: 'btn empty-state-action', text: 'Browse connectors' });
    connBtn.addEventListener('click', () => {
      import('../app.js').then(({ navigateTo }) => {
        if (typeof navigateTo === 'function') navigateTo('settings', { tab: 'connectors' });
      }).catch(() => {});
    });
    actions.appendChild(connBtn);

    empty.appendChild(actions);
    gridEl.appendChild(empty);
    return;
  }

  for (const skill of skills) {
    gridEl.appendChild(renderSkillCard(skill));
  }
}

/**
 * @param {object} skill - from skill list --json
 * @returns {HTMLElement}
 */
function renderSkillCard(skill) {
  const card = el('div', { cls: `skill-card${skill.archived ? ' archived' : ''}` });

  // Header
  const hdr = el('div', { cls: 'skill-card-header' });
  hdr.appendChild(el('span', { cls: 'skill-name', text: skill.name || '?' }));
  const badges = el('div', { cls: 'skill-badges' });
  if (skill.kind)    badges.appendChild(el('span', { cls: 'chip chip-gray',    text: skill.kind }));
  if (skill.origin)  badges.appendChild(el('span', { cls: 'chip chip-blue',    text: skill.origin }));
  if (skill.archived) badges.appendChild(el('span', { cls: 'chip chip-amber',  text: 'archived' }));
  hdr.appendChild(badges);
  card.appendChild(hdr);

  // Purpose
  if (skill.purpose) card.appendChild(el('div', { cls: 'skill-purpose', text: skill.purpose }));

  // Reliability bar (Laplace)
  const runs      = skill.runs      || 0;
  const successes = skill.successes || 0;
  const rel       = laplace(successes, runs);
  const relPct    = Math.round(rel * 100);

  const relWrap = el('div', { cls: 'reliability-bar-wrap' });
  const relLabel = el('div', { cls: 'reliability-label' });
  relLabel.appendChild(el('span', { text: 'reliability (Laplace)' }));
  relLabel.appendChild(el('span', { text: `${relPct}%` }));
  relWrap.appendChild(relLabel);
  const relTrack = el('div', { cls: 'reliability-track' });
  relTrack.appendChild(el('div', { cls: 'reliability-fill', style: `width:${relPct}%` }));
  relWrap.appendChild(relTrack);
  card.appendChild(relWrap);

  // Metrics row
  const metrics = el('div', { cls: 'skill-metrics' });
  metrics.appendChild(metricSpan(`${runs} runs`));
  const fails = skill.failures || 0;
  if (fails > 0) {
    metrics.appendChild(el('span', { cls: 'skill-metric red', text: `${fails} fails` }));
  }
  if (skill.last_used_ms) {
    metrics.appendChild(metricSpan(fmtTime(skill.last_used_ms)));
  }
  if (skill.open_issues > 0) {
    metrics.appendChild(el('span', { cls: 'skill-metric red', text: `⚠ ${skill.open_issues} issues` }));
  }
  card.appendChild(metrics);

  // Sparkline from timeline buffer
  const sparkValues = buildSparkline(skill.name);
  if (sparkValues.length > 0) {
    const sparkWrap = el('div', { cls: 'sparkline-wrap' });
    sparkWrap.appendChild(svgSparkline(sparkValues));
    card.appendChild(sparkWrap);
  }

  // Run button (non-archived skills only)
  if (!skill.archived) {
    const runBtn = el('button', { cls: 'btn btn-sm skill-run-btn', text: '▶ Run' });
    runBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleRunSkill(skill.name, runBtn);
    });
    card.appendChild(runBtn);
  }

  // Click handler - open modal
  card.addEventListener('click', () => openSkillModal(skill));
  return card;
}

/**
 * Build sparkline data from the timeline buffer for a skill name.
 * Takes last 20 skill.run events for this skill.
 * @param {string} name
 * @returns {boolean[]} ok values, oldest first
 */
function buildSparkline(name) {
  const events = get('events') || [];
  const runs = events
    .filter(ev => ev.kind === 'skill.run' && (ev.skill || (ev.data && ev.data.skill) || (ev.data && ev.data.name) || ev.name) === name)
    .slice(0, 20)
    .reverse(); // oldest first
  return runs.map(ev => {
    const d = ev.data || ev;
    return d.ok === true || d.ok === 'true';
  });
}

function metricSpan(text) {
  return el('span', { cls: 'skill-metric dim', text });
}

// ── Skill modal ─────────────────────────────────────────────────

/**
 * Open the skill detail modal.
 * @param {object} skill - from skill list
 */
async function openSkillModal(skill) {
  const modal = /** @type {HTMLDialogElement|null} */ (document.getElementById('skill-modal'));
  const content = document.getElementById('skill-modal-content');
  if (!modal || !content) return;

  content.innerHTML = '';

  // Header row: name + close button (detail rendered after load)
  const modalHdr = el('div', { cls: 'modal-header' });
  modalHdr.appendChild(el('div', { cls: 'modal-title', text: skill.name || '?' }));
  const closeBtn = el('button', { cls: 'btn-icon', 'aria-label': 'Close', text: '✕' });
  closeBtn.addEventListener('click', () => modal.close());
  modalHdr.appendChild(closeBtn);
  content.appendChild(modalHdr);

  // Loading state
  const loadingEl = el('div', { cls: 'dim', style: 'margin-bottom:12px', text: 'Loading…' });
  content.appendChild(loadingEl);

  modal.showModal();

  // Click outside to close
  modal.addEventListener('click', function closeOnBackdrop(e) {
    if (e.target === modal) { modal.close(); modal.removeEventListener('click', closeOnBackdrop); }
  });

  // Load full manifest
  const project = get('currentProject');
  try {
    const detail = await skillShow(skill.name, project);
    loadingEl.remove();
    // Replace placeholder header with full human-first header
    content.innerHTML = '';
    renderSkillDetail(content, skill, detail, modal);
  } catch (e) {
    loadingEl.textContent = `Failed to load: ${e}`;
  }
}

/**
 * Render the human-first skill detail modal per UI-SPEC §9.2.
 * Each section is wrapped in try/catch - bad data renders as dim '-'.
 *
 * @param {HTMLElement} content  - modal content container
 * @param {object}      skill    - from skill list
 * @param {object}      detail   - from skill show --json
 * @param {HTMLDialogElement} modal - for close/update callbacks
 */
function renderSkillDetail(content, skill, detail, modal) {
  const manifest  = (detail && detail.manifest) ? detail.manifest : {};
  const runs      = (detail && detail.runs      != null) ? detail.runs      : (skill.runs      || 0);
  const successes = (detail && detail.successes != null) ? detail.successes : (skill.successes || 0);
  const failures  = (detail && detail.failures  != null) ? detail.failures  : (skill.failures  || 0);
  const lastUsed  = (detail && detail.last_used_ms) || skill.last_used_ms;
  const openIssues = (detail && detail.open_issues != null) ? detail.open_issues : (skill.open_issues || 0);
  const origin    = detail && detail.origin ? detail.origin : (skill.origin || null);
  const skillName = (manifest && manifest.name) || skill.name || '?';

  // ── 1. Header ────────────────────────────────────────────────────
  try {
    const hdr = el('div', { cls: 'modal-header' });
    const titleWrap = el('div', { cls: 'modal-title-wrap' });
    titleWrap.appendChild(el('span', { cls: 'modal-title', text: skillName }));

    const chips = el('div', { cls: 'skill-badges', style: 'margin-left:8px' });
    const kind = (manifest && manifest.kind) || skill.kind;
    if (kind)   chips.appendChild(el('span', { cls: 'chip chip-gray',  text: kind }));
    if (origin) chips.appendChild(el('span', { cls: 'chip chip-blue',  text: origin }));
    if (skill.archived || (manifest && manifest.archived)) {
      chips.appendChild(el('span', { cls: 'chip chip-amber', text: 'archived' }));
    }
    titleWrap.appendChild(chips);
    hdr.appendChild(titleWrap);

    const hdrBtns = el('div', { style: 'display:flex;gap:6px;align-items:center' });

    if (!skill.archived && !(manifest && manifest.archived)) {
      const runBtn = el('button', { cls: 'btn btn-sm btn-green', text: '▶ Run' });
      runBtn.addEventListener('click', async () => {
        if (isRunning()) {
          showToast('a run is already in progress', 'error');
          return;
        }
        // We already hold the manifest - prompt for {input} inside the
        // modal (the inline row needs an attached button), THEN close.
        const cmd = (manifest && manifest.run && manifest.run.cmd) ? String(manifest.run.cmd) : '';
        let inputValue = null;
        if (cmd.includes('{input}')) {
          inputValue = await promptSkillInput(runBtn, skillName);
          if (inputValue === null) return; // cancelled
        }
        modal.close();
        const args = ['skill', 'run', skillName];
        if (inputValue !== null && inputValue !== '') args.push(inputValue);
        await startRun(`skill run ${skillName}`, args, get('currentProject'), {
          onDone: () => triggerPollAndVerify(),
        });
      });
      hdrBtns.appendChild(runBtn);
    }

    // Edit - opens the shared modal pre-filled from this manifest. Saving
    // re-stages the manifest and runs `skill add` to overwrite in place.
    if (!skill.archived && !(manifest && manifest.archived)) {
      const editBtn = el('button', { cls: 'btn btn-sm', text: 'Edit' });
      editBtn.addEventListener('click', () => {
        modal.close();
        openSkillForm(manifest && manifest.name ? manifest : { ...manifest, name: skillName });
      });
      hdrBtns.appendChild(editBtn);
    }

    const closeBtn = el('button', { cls: 'btn-icon', 'aria-label': 'Close', text: '✕' });
    closeBtn.addEventListener('click', () => modal.close());
    hdrBtns.appendChild(closeBtn);
    hdr.appendChild(hdrBtns);
    content.appendChild(hdr);
  } catch (e) {
    content.appendChild(el('div', { cls: 'dim', text: `header error: ${e.message}` }));
  }

  // ── 2. What it does ──────────────────────────────────────────────
  try {
    const sec = el('div', { cls: 'inspector-section' });
    sec.appendChild(el('div', { cls: 'inspector-section-title', text: 'What it does' }));

    const purpose = (manifest && manifest.purpose) || skill.purpose;
    sec.appendChild(el('div', { cls: purpose ? '' : 'dim', text: purpose || '-' }));

    const goal = (manifest && manifest.goal) || skill.goal;
    if (goal) {
      sec.appendChild(el('div', { cls: 'skill-detail-goal', text: `Goal: ${goal}` }));
    }

    const tags = (manifest && manifest.tags) || skill.tags || [];
    if (tags.length > 0) {
      const tagRow = el('div', { cls: 'skill-badges', style: 'margin-top:6px;flex-wrap:wrap' });
      for (const t of tags) {
        tagRow.appendChild(el('span', { cls: 'chip chip-gray', text: t }));
      }
      sec.appendChild(tagRow);
    }

    content.appendChild(sec);
  } catch (e) {
    content.appendChild(el('div', { cls: 'dim', text: `what-it-does error: ${e.message}` }));
  }

  // ── 3. How it runs ───────────────────────────────────────────────
  try {
    const sec = el('div', { cls: 'inspector-section' });
    sec.appendChild(el('div', { cls: 'inspector-section-title', text: 'How it runs' }));

    const cmd     = (manifest && manifest.run && manifest.run.cmd)       ? manifest.run.cmd       : null;
    const timeout = (manifest && manifest.run && manifest.run.timeout_s) ? manifest.run.timeout_s : null;
    const success = (manifest && manifest.success) ? manifest.success : null;
    const successKind = success && success.kind ? success.kind : null;

    // Command block
    if (cmd) {
      sec.appendChild(el('pre', { cls: 'cmd-block', text: cmd }));
    } else {
      sec.appendChild(el('div', { cls: 'dim', text: '-' }));
    }

    // Plain-language success sentence
    let successSentence = '';
    if (successKind === 'exit0') {
      successSentence = 'Succeeds when the command exits 0.';
    } else if (successKind === 'contains' && success && success.text) {
      successSentence = `Succeeds when the output contains "${success.text}".`;
    } else if (successKind === 'contains') {
      successSentence = 'Succeeds when the output contains the expected text.';
    } else if (successKind) {
      successSentence = `Success rule: ${successKind}.`;
    }
    if (successSentence) {
      sec.appendChild(el('div', { cls: 'skill-detail-success', text: successSentence }));
    }

    // Timeout line
    if (timeout != null) {
      sec.appendChild(el('div', { cls: 'skill-detail-timeout', text: `Times out after ${timeout}s.` }));
    }

    // Copyable CLI line
    const cliLine = `soma skill run ${skillName}`;
    sec.appendChild(el('pre', { cls: 'cmd-block', text: cliLine }));

    const copyBtn = el('button', { cls: 'btn btn-sm', text: 'Copy' });
    copyBtn.addEventListener('click', () => {
      if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(cliLine).then(() => {
          showToast('Copied to clipboard', 'success');
        }).catch(() => {
          showToast('Copy failed', 'error');
        });
      } else {
        showToast('Clipboard not available', 'error');
      }
    });
    sec.appendChild(copyBtn);

    content.appendChild(sec);
  } catch (e) {
    content.appendChild(el('div', { cls: 'dim', text: `how-it-runs error: ${e.message}` }));
  }

  // ── 4. Track record ──────────────────────────────────────────────
  try {
    const sec = el('div', { cls: 'inspector-section' });
    sec.appendChild(el('div', { cls: 'inspector-section-title', text: 'Track record' }));

    const rel    = laplace(successes, runs);
    const relPct = Math.round(rel * 100);

    // Reliability bar
    const relWrap = el('div', { cls: 'reliability-bar-wrap' });
    const relLabel = el('div', { cls: 'reliability-label' });
    relLabel.appendChild(el('span', { text: `${successes} of ${runs} runs succeeded · Laplace ${relPct}%` }));
    relWrap.appendChild(relLabel);
    const relTrack = el('div', { cls: 'reliability-track' });
    const relFill = el('div', { cls: 'reliability-fill', style: `width:${relPct}%` });
    relFill.title = 'smoothed so 1/1 ≠ 100%';
    relTrack.appendChild(relFill);
    relWrap.appendChild(relTrack);
    const relNote = el('div', { cls: 'dim', style: 'font-size:11px;margin-top:2px', text: 'smoothed so 1/1 ≠ 100%' });
    relNote.title = 'Laplace smoothing: (successes+1)/(runs+2)';
    relWrap.appendChild(relNote);
    sec.appendChild(relWrap);

    // Sparkline
    const sparkValues = buildSparkline(skillName);
    if (sparkValues.length > 0) {
      const sparkWrap = el('div', { cls: 'sparkline-wrap', style: 'margin-top:8px' });
      sparkWrap.appendChild(svgSparkline(sparkValues, 200, 20));
      sec.appendChild(sparkWrap);
    }

    // Last ≤8 skill.run events from events buffer
    const allEvents = get('events') || [];
    const skillRuns = allEvents
      .filter(ev => {
        if (ev.kind !== 'skill.run') return false;
        const d = ev.data || ev;
        const n = d.skill || d.name || ev.skill || ev.name || '';
        return n === skillName;
      })
      .slice(0, 8);

    if (skillRuns.length > 0) {
      const runList = el('div', { cls: 'run-list', style: 'margin-top:8px' });
      for (const ev of skillRuns) {
        try {
          const d = ev.data || ev;
          const ok = d.ok === true || d.ok === 'true';
          const ts = ev.t || ev.ts;
          const row = el('div', { cls: 'run-list-row' });
          row.appendChild(el('span', { cls: 'dim', style: 'min-width:70px', text: fmtTime(ts) }));
          row.appendChild(el('span', { cls: `chip ${ok ? 'chip-green' : 'chip-red'}`, text: ok ? 'ok' : 'fail' }));
          const summary = eventSummary(ev);
          if (summary) row.appendChild(el('span', { cls: 'run-list-summary', text: summary }));
          runList.appendChild(row);
        } catch (_) {
          // skip malformed event row
        }
      }
      sec.appendChild(runList);
    }

    content.appendChild(sec);
  } catch (e) {
    content.appendChild(el('div', { cls: 'dim', text: `track-record error: ${e.message}` }));
  }

  // ── 5. Issues (only when open_issues > 0) ────────────────────────
  if (openIssues > 0) {
    try {
      const sec = el('div', { cls: 'inspector-section' });
      sec.appendChild(el('div', { cls: 'inspector-section-title', text: `Issues (${openIssues})` }));

      const project = get('currentProject');
      (async () => {
        try {
          const allIssues = await somaJson(['issues', 'list', '--json'], project);
          const issues = Array.isArray(allIssues)
            ? allIssues.filter(iss => (iss.skill || iss.target) === skillName)
            : [];
          if (issues.length > 0) {
            for (const iss of issues) {
              try {
                const row = el('div', { cls: 'run-list-row' });
                row.appendChild(el('span', { cls: 'dim', style: 'min-width:70px', text: fmtTime(iss.t || iss.ts || iss.time) }));
                const title = iss.title || iss.kind || iss.message || '?';
                row.appendChild(el('span', { text: title }));
                sec.appendChild(row);
              } catch (_) {}
            }
          } else {
            sec.appendChild(el('div', { cls: 'dim', text: `${openIssues} open issue(s) - details unavailable` }));
          }
        } catch (_) {
          sec.appendChild(el('div', { cls: 'dim', text: `${openIssues} open issue(s) - could not load details` }));
        }
      })();

      content.appendChild(sec);
    } catch (e) {
      content.appendChild(el('div', { cls: 'dim', text: `issues error: ${e.message}` }));
    }
  }

  // ── 6. Lineage ───────────────────────────────────────────────────
  try {
    const sec = el('div', { cls: 'inspector-section' });
    sec.appendChild(el('div', { cls: 'inspector-section-title', text: 'Lineage' }));

    const dl = el('dl', { cls: 'def-list' });
    appendDef(dl, 'version', manifest && manifest.version != null ? String(manifest.version) : '-');
    appendDef(dl, 'origin',  origin || '-');
    appendDef(dl, 'last used', lastUsed ? fmtTime(lastUsed) : '-');
    sec.appendChild(dl);
    content.appendChild(sec);
  } catch (e) {
    content.appendChild(el('div', { cls: 'dim', text: `lineage error: ${e.message}` }));
  }

  // ── 7. Raw JSON (collapsed) ──────────────────────────────────────
  try {
    const rawSec = el('div', { cls: 'inspector-section' });
    rawSec.appendChild(rawJsonDetails({ manifest, ...detail }, 'Raw JSON (manifest + full response)'));
    content.appendChild(rawSec);
  } catch (e) {
    content.appendChild(el('div', { cls: 'dim', text: `raw json error: ${e.message}` }));
  }
}

function appendDef(dl, key, value) {
  dl.appendChild(el('dt', { cls: 'def-key', text: key }));
  dl.appendChild(el('dd', { cls: 'def-val', text: value }));
}

// ── Run skill (v2) ───────────────────────────────────────────────

/**
 * Handle the ▶ Run button for a skill card or modal.
 * Loads the manifest, checks for {input} placeholder, prompts if needed,
 * then streams `skill run <name> [input]` into the shared console.
 *
 * @param {string} skillName
 * @param {HTMLButtonElement} btn
 */
async function handleRunSkill(skillName, btn) {
  if (isRunning()) {
    showToast('a run is already in progress', 'error');
    return;
  }

  const project = get('currentProject');
  btn.disabled = true;

  let inputValue = null;
  let needsInput = false;

  // Fetch manifest to check for {input} placeholder.
  try {
    const detail = await skillShow(skillName, project);
    const manifest = detail && detail.manifest ? detail.manifest : detail;
    const cmd = (manifest && manifest.run && manifest.run.cmd) ? String(manifest.run.cmd) : '';
    needsInput = cmd.includes('{input}');
  } catch (_) {
    // If show fails, proceed without input check.
  }

  if (needsInput) {
    // Show an inline prompt below the button.
    inputValue = await promptSkillInput(btn, skillName);
    if (inputValue === null) {
      // User cancelled.
      btn.disabled = false;
      return;
    }
  }

  const args = ['skill', 'run', skillName];
  if (inputValue !== null && inputValue !== '') {
    args.push(inputValue);
  }

  await startRun(`skill run ${skillName}`, args, project, {
    onDone: (_code) => {
      btn.disabled = false;
      triggerPollAndVerify();
    },
  });
}

/**
 * Insert an inline input row below the run button, resolve with the value
 * (or null if cancelled).
 *
 * @param {HTMLButtonElement} btn
 * @param {string} skillName
 * @returns {Promise<string|null>}
 */
function promptSkillInput(btn, skillName) {
  return new Promise((resolve) => {
    // Remove any existing inline prompt
    const existing = btn.parentNode && btn.parentNode.querySelector('.skill-input-row');
    if (existing) existing.remove();

    const row = el('div', { cls: 'skill-input-row' });
    const input = el('input', {
      type: 'text',
      placeholder: `input for ${skillName}`,
      style: 'flex:1;font-size:12px',
    });
    const confirmBtn = el('button', { cls: 'btn btn-green', text: 'Run' });
    const cancelBtn = el('button', { cls: 'btn', text: 'Cancel' });

    function finish(value) {
      row.remove();
      resolve(value);
    }

    confirmBtn.addEventListener('click', () => finish(input.value));
    cancelBtn.addEventListener('click', () => finish(null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(input.value);
      if (e.key === 'Escape') finish(null);
    });

    row.appendChild(input);
    row.appendChild(confirmBtn);
    row.appendChild(cancelBtn);

    if (btn.parentNode) {
      btn.insertAdjacentElement('afterend', row);
    }
    input.focus();
  });
}

function triggerPollAndVerify() {
  import('../app.js').then(({ triggerPollAndVerify: tpv }) => {
    if (typeof tpv === 'function') tpv();
  }).catch(() => {});
}
