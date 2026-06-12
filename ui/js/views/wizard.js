/**
 * wizard.js - Onboarding wizard (U9).
 *
 * 4 steps: Project, Preset, Models, Done.
 * Each step shows the exact soma command before running it.
 *
 * @module views/wizard
 */

import { el, rawJsonDetails } from '../render.js';
import { get, setState } from '../state.js';
import { somaRaw, modelProbe } from '../soma.js';
import { showToast } from './toast.js';

export const PRESETS = [
  {
    id: 'local-only',
    name: 'local-only',
    desc: 'Fully air-gapped. No egress, no external model calls.',
    changes: [
      'network.allow = false',
      'network.hosts = []',
      'Provider: ollama only',
      'Autonomy: assist (manual proposals)',
    ],
  },
  {
    id: 'hybrid',
    name: 'hybrid-default',
    desc: 'Network on, Anthropic + Ollama providers, difficulty-based routing.',
    changes: [
      'network.allow = true',
      'network.hosts = [anthropic.com, …]',
      'Providers: anthropic + ollama',
      'Difficulty routing enabled',
    ],
  },
  {
    id: 'cloud-max',
    name: 'cloud-max',
    desc: 'All requests routed to cloud tier (Anthropic). Best capability.',
    changes: [
      'network.allow = true',
      'network.hosts = [anthropic.com]',
      'Provider: anthropic only (cloud tier)',
      'Difficulty: complex default',
    ],
  },
  {
    id: 'low-ram',
    name: 'low-ram',
    desc: 'Reduced caches and limits for memory-constrained machines.',
    changes: [
      'cache.max_entries reduced',
      'max_timeout_s reduced',
      'Model: smallest tier',
      'Network: local-only by default',
    ],
  },
];

let _step = 1;
let _data = { dir: '', name: '', withBuiltins: true, preset: '' };
let _probeResults = [];

/**
 * Open the wizard dialog (first-run or "add project").
 */
export function openWizard() {
  _step = 1;
  _data = { dir: '', name: '', withBuiltins: true, preset: '' };
  _probeResults = [];
  const dialog = document.getElementById('wizard-dialog');
  if (dialog) {
    renderWizard();
    dialog.showModal();
  }
}

/**
 * Close the wizard dialog.
 */
export function closeWizard() {
  const dialog = document.getElementById('wizard-dialog');
  if (dialog) dialog.close();
}

function renderWizard() {
  const content = document.getElementById('wizard-content');
  if (!content) return;
  content.innerHTML = '';

  // Header with step dots
  const hdr = el('div', { cls: 'wizard-header' });
  hdr.appendChild(el('div', { cls: 'wizard-title', text: 'New project' }));

  const steps = el('div', { cls: 'wizard-steps' });
  const STEP_LABELS = ['Project', 'Preset', 'Models', 'Done'];
  for (let i = 1; i <= 4; i++) {
    const stepEl = el('div', { cls: `wizard-step-dot${i === _step ? ' active' : i < _step ? ' done' : ''}` });
    const numEl = el('span', { cls: 'step-num', text: i < _step ? '✓' : String(i) });
    stepEl.appendChild(numEl);
    stepEl.appendChild(el('span', { text: STEP_LABELS[i - 1] }));
    steps.appendChild(stepEl);
  }
  hdr.appendChild(steps);
  content.appendChild(hdr);

  const body = el('div', { cls: 'wizard-body', id: 'wizard-body' });
  content.appendChild(body);

  const footer = el('div', { cls: 'wizard-footer', id: 'wizard-footer' });
  content.appendChild(footer);

  renderStep(body, footer);
}

function renderStep(body, footer) {
  body.innerHTML = '';
  footer.innerHTML = '';

  switch (_step) {
    case 1: renderStep1(body, footer); break;
    case 2: renderStep2(body, footer); break;
    case 3: renderStep3(body, footer); break;
    case 4: renderStep4(body, footer); break;
  }
}

// ── Step 1: Project ─────────────────────────────────────────────

function renderStep1(body, footer) {
  body.appendChild(el('p', { cls: 'dim', style: 'margin-bottom:14px;font-size:12px', text: 'Enter the project directory to initialise.' }));

  const dirField = el('div', { cls: 'wizard-field' });
  dirField.appendChild(el('label', { text: 'Directory (paste a path or browse)' }));
  const dirRow = el('div', { style: 'display:flex;gap:8px;align-items:center' });
  const dirInput = el('input', { type: 'text', placeholder: '/Users/you/myproject', value: _data.dir, style: 'flex:1' });
  dirInput.addEventListener('input', () => { _data.dir = dirInput.value.trim(); updateStep1Preview(); });
  const browseBtn = el('button', { cls: 'btn', text: 'Browse…', style: 'flex:none' });
  browseBtn.addEventListener('click', async () => {
    try {
      const picked = await window.__TAURI__.core.invoke('pick_directory');
      if (picked) {
        _data.dir = picked.replace(/\/$/, '');
        dirInput.value = _data.dir;
        if (!_data.name) {
          _data.name = _data.dir.split('/').filter(Boolean).pop() || '';
          const nameInput = document.getElementById('wizard-name-input');
          if (nameInput) nameInput.value = _data.name;
        }
        updateStep1Preview();
      }
    } catch (e) {
      showToast(`browse: ${e}`, 'error');
    }
  });
  dirRow.appendChild(dirInput);
  dirRow.appendChild(browseBtn);
  dirField.appendChild(dirRow);
  body.appendChild(dirField);

  const nameField = el('div', { cls: 'wizard-field' });
  nameField.appendChild(el('label', { text: 'Project name' }));
  const nameInput = el('input', { id: 'wizard-name-input', type: 'text', placeholder: 'my-project', value: _data.name });
  nameInput.addEventListener('input', () => { _data.name = nameInput.value.trim(); updateStep1Preview(); });
  nameField.appendChild(nameInput);
  body.appendChild(nameField);

  const builtinsField = el('div', { cls: 'wizard-field' });
  const builtinsLabel = el('label', { style: 'display:flex;align-items:center;gap:8px;cursor:pointer' });
  // width:auto - .wizard-field input{width:100%} otherwise stretches the
  // checkbox across the row and pushes the label text out of view.
  const builtinsCheck = el('input', { type: 'checkbox', style: 'width:auto;flex:none' });
  builtinsCheck.checked = _data.withBuiltins;
  builtinsCheck.addEventListener('change', () => { _data.withBuiltins = builtinsCheck.checked; updateStep1Preview(); });
  builtinsLabel.appendChild(builtinsCheck);
  builtinsLabel.appendChild(el('span', { text: 'With builtin skills (cargo-build, cargo-test, git-status, disk-usage)', style: 'color:var(--text);font-size:12px' }));
  builtinsField.appendChild(builtinsLabel);
  body.appendChild(builtinsField);

  // Command preview
  const previewEl = el('div', { cls: 'wizard-cmd-preview', id: 'step1-preview' });
  body.appendChild(previewEl);

  updateStep1Preview();

  function updateStep1Preview() {
    const preview = document.getElementById('step1-preview');
    if (!preview) return;
    const args = buildInitArgs();
    preview.textContent = `soma ${args.join(' ')}`;
  }

  // Footer
  const cancelBtn = el('button', { cls: 'btn', text: 'Cancel' });
  cancelBtn.addEventListener('click', closeWizard);
  footer.appendChild(cancelBtn);

  const nextBtn = el('button', { cls: 'btn btn-green', text: 'Initialize →' });
  nextBtn.addEventListener('click', async () => {
    if (!_data.dir) { showToast('Please enter a directory.', 'error'); return; }
    nextBtn.disabled = true;
    nextBtn.textContent = 'Running…';
    await runStep1(nextBtn);
  });
  footer.appendChild(nextBtn);
}

function buildInitArgs() {
  // init takes the directory as a POSITIONAL argument - the global
  // --project flag is ignored by init, so it must not be relied on here.
  const args = ['init'];
  if (_data.dir) args.push(_data.dir);
  if (_data.name) args.push('--name', _data.name);
  if (_data.withBuiltins) args.push('--with-builtins');
  return args;
}

async function runStep1(btn) {
  const args = buildInitArgs();
  try {
    const result = await somaRaw(args, null);
    const msg = result.code === 0
      ? (result.stdout.trim() || 'Project initialized.')
      : (result.stderr.trim() || `exit ${result.code}`);
    showToast(msg, result.code === 0 ? 'success' : 'error');

    if (result.code === 0) {
      _step = 2;
      renderWizard();
    } else {
      btn.disabled = false;
      btn.textContent = 'Initialize →';
    }
  } catch (e) {
    showToast(String(e), 'error');
    btn.disabled = false;
    btn.textContent = 'Initialize →';
  }
}

// ── Step 2: Preset ──────────────────────────────────────────────

function renderStep2(body, footer) {
  body.appendChild(el('p', { cls: 'dim', style: 'margin-bottom:14px;font-size:12px', text: 'Choose a configuration preset.' }));

  const cards = el('div', { cls: 'preset-cards' });
  for (const preset of PRESETS) {
    const card = el('div', { cls: `preset-card${_data.preset === preset.id ? ' selected' : ''}` });
    card.appendChild(el('div', { cls: 'preset-card-name', text: preset.name }));
    card.appendChild(el('div', { cls: 'preset-card-desc', text: preset.desc }));
    const changesList = el('ul', { cls: 'preset-card-changes' });
    for (const change of preset.changes) {
      changesList.appendChild(el('li', { text: change }));
    }
    card.appendChild(changesList);
    card.addEventListener('click', () => {
      _data.preset = preset.id;
      // Update selected state
      for (const c of cards.children) c.classList.remove('selected');
      card.classList.add('selected');
      updateStep2Preview();
    });
    cards.appendChild(card);
  }
  body.appendChild(cards);

  const previewEl = el('div', { cls: 'wizard-cmd-preview', style: 'margin-top:12px', id: 'step2-preview' });
  body.appendChild(previewEl);
  updateStep2Preview();

  function updateStep2Preview() {
    const preview = document.getElementById('step2-preview');
    if (!preview) return;
    preview.textContent = _data.preset
      ? `soma preset apply ${_data.preset}`
      : '(select a preset above)';
  }

  // Footer
  const backBtn = el('button', { cls: 'btn', text: '← Back' });
  backBtn.addEventListener('click', () => { _step = 1; renderWizard(); });
  footer.appendChild(backBtn);

  const nextBtn = el('button', { cls: 'btn btn-green', text: 'Apply preset →' });
  nextBtn.addEventListener('click', async () => {
    if (!_data.preset) { showToast('Please select a preset.', 'error'); return; }
    nextBtn.disabled = true;
    nextBtn.textContent = 'Applying…';
    await runStep2(nextBtn);
  });
  footer.appendChild(nextBtn);
}

async function runStep2(btn) {
  try {
    // preset apply emits human text (not part of the --json contract)
    const result = await somaRaw(['preset', 'apply', _data.preset], _data.dir);
    const msg = result.code === 0
      ? (result.stdout.trim() || `Preset ${_data.preset} applied.`)
      : (result.stderr.trim() || `exit ${result.code}`);
    showToast(msg, result.code === 0 ? 'success' : 'error');

    if (result.code === 0) {
      _step = 3;
      renderWizard();
      // Run probe for step 3
      runProbe();
    } else {
      btn.disabled = false;
      btn.textContent = 'Apply preset →';
    }
  } catch (e) {
    showToast(String(e), 'error');
    btn.disabled = false;
    btn.textContent = 'Apply preset →';
  }
}

// ── Step 3: Models ──────────────────────────────────────────────

async function runProbe() {
  try {
    _probeResults = await modelProbe(_data.dir) || [];
  } catch (e) {
    _probeResults = [];
  }
  const probeListEl = document.getElementById('probe-list');
  if (probeListEl) renderProbeList(probeListEl);
}

function renderStep3(body, footer) {
  body.appendChild(el('p', { cls: 'dim', style: 'margin-bottom:14px;font-size:12px', text: 'Checking provider connectivity…' }));
  body.appendChild(el('div', { cls: 'wizard-cmd-preview', text: 'soma model probe --json' }));

  const probeListEl = el('div', { cls: 'probe-list', id: 'probe-list' });
  body.appendChild(probeListEl);

  if (_probeResults.length > 0) {
    renderProbeList(probeListEl);
  } else {
    probeListEl.appendChild(el('div', { cls: 'dim', text: 'Running probe…' }));
    runProbe();
  }

  const footer2 = footer;
  const backBtn = el('button', { cls: 'btn', text: '← Back' });
  backBtn.addEventListener('click', () => { _step = 2; renderWizard(); });
  footer2.appendChild(backBtn);

  const nextBtn = el('button', { cls: 'btn btn-green', text: 'Continue →' });
  nextBtn.addEventListener('click', () => { _step = 4; renderWizard(); });
  footer2.appendChild(nextBtn);
}

function renderProbeList(el2) {
  el2.innerHTML = '';
  if (_probeResults.length === 0) {
    el2.appendChild(el('div', { cls: 'dim', text: 'No probe results yet.' }));
    return;
  }
  for (const p of _probeResults) {
    const row = el('div', { cls: 'probe-row' });
    const dot = el('span', { cls: `dot ${p.ok ? 'dot-ok' : 'dot-err'}`, style: 'margin-top:3px;flex-shrink:0' });
    row.appendChild(dot);
    const info = el('div', { style: 'flex:1' });
    info.appendChild(el('div', { style: 'font-weight:600;font-size:12px', text: p.provider || '?' }));
    if (p.note) info.appendChild(el('div', { cls: 'dim', style: 'font-size:11px', text: p.note }));

    // Fix hints
    if (!p.ok) {
      const hint = getFixHint(p.provider || '', p.note || '');
      if (hint) info.appendChild(el('div', { cls: 'probe-hint', text: hint }));
    }
    row.appendChild(info);
    el2.appendChild(row);
  }
}

function getFixHint(provider, note) {
  const lc = provider.toLowerCase() + ' ' + note.toLowerCase();
  if (lc.includes('ollama')) {
    return 'start ollama: `ollama serve`';
  }
  if (lc.includes('anthropic')) {
    return 'export ANTHROPIC_API_KEY=… in the shell that runs soma - the cockpit never touches keys';
  }
  return '';
}

// ── Step 4: Done ────────────────────────────────────────────────

function renderStep4(body, footer) {
  body.appendChild(el('div', { cls: 'green', style: 'font-size:16px;font-weight:700;margin-bottom:12px', text: '✓ Project ready' }));
  body.appendChild(el('p', { cls: 'dim', style: 'font-size:12px;margin-bottom:14px', text: 'You just watched yourself being journaled. The events below were produced by the steps you ran.' }));

  // Show project.init + preset.apply events from buffer
  const events = get('events') || [];
  const initEvents = events.filter(ev =>
    ev.kind === 'project.init' || ev.kind === 'preset.apply'
  ).slice(0, 10);

  if (initEvents.length > 0) {
    const evSection = el('div', { style: 'margin-bottom:12px' });
    evSection.appendChild(el('div', { cls: 'inspector-section-title', text: 'Journal events produced' }));
    for (const ev of initEvents) {
      const row = el('div', { style: 'padding:4px 0;font-size:11px;border-bottom:1px solid var(--border);font-family:var(--mono)' });
      row.appendChild(el('span', { cls: `chip chip-project`, style: 'margin-right:6px', text: ev.kind }));
      row.appendChild(el('span', { cls: 'dim', text: JSON.stringify(ev.data || {}).slice(0, 80) }));
      evSection.appendChild(row);
    }
    body.appendChild(evSection);
  } else {
    body.appendChild(el('div', { cls: 'dim', style: 'font-size:11px', text: 'Load the timeline to see your init events.' }));
  }

  const doneBtn = el('button', { cls: 'btn btn-green', text: 'Open project' });
  doneBtn.addEventListener('click', async () => {
    closeWizard();
    // Trigger project list reload
    import('../app.js').then(({ boot }) => {
      // Re-bootstrap project list
    }).catch(() => {});
    // Reload projects
    const { projectList } = await import('../soma.js');
    const { setState: st } = await import('../state.js');
    try {
      const projects = await projectList();
      st({ projects: projects || [] });
      // Switch to the new project
      if (_data.dir) {
        const { switchProject } = await import('../app.js');
        if (typeof switchProject === 'function') switchProject(_data.dir);
      }
    } catch (_) {}
  });
  footer.appendChild(doneBtn);
}
