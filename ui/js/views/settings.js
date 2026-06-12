/**
 * settings.js - Settings hub (v5, UI-SPEC §9.1 + §9.5).
 *
 * Tabs: Models · Connectors · Ecosystem · Profiles
 * Each tab mounts the corresponding existing module into a tab-panel div.
 * Deep-link: navigateTo('settings', {tab, prefill}) selects a tab on open.
 *
 * Iron rules unchanged: no key entry, no .soma/ writes from UI.
 *
 * @module views/settings
 */

import { el, cmdPreview } from '../render.js';
import { get } from '../state.js';
import { somaJson, somaRaw } from '../soma.js';
import { showToast } from './toast.js';
import { mountConfig, unmountConfig } from './config.js';
import { mountMcp, unmountMcp } from './mcp.js';
import { mountEcosystem, unmountEcosystem } from './ecosystem.js';
import { prefillConnector } from './catalog.js';
import { PRESETS } from './wizard.js';

// ── State ──────────────────────────────────────────────────────────────

let _mounted = false;
/** @type {string} */
let _activeTab = 'models';

const TABS = [
  { id: 'models',     label: 'Models' },
  { id: 'connectors', label: 'Connectors' },
  { id: 'ecosystem',  label: 'Ecosystem' },
  { id: 'profiles',   label: 'Profiles' },
];

/** Maps tab id → unmount function for the mounted sub-module */
const TAB_UNMOUNTERS = {
  models:     unmountConfig,
  connectors: unmountMcp,
  ecosystem:  unmountEcosystem,
  profiles:   () => {},
};

// ── Mount / Unmount ────────────────────────────────────────────────────

/**
 * Mount the Settings hub into #view-container.
 * @param {{ tab?: string, prefill?: string }} [opts]
 */
export async function mountSettings(opts) {
  _mounted = true;
  const tab = (opts && opts.tab) ? opts.tab : 'models';
  _activeTab = TABS.find(t => t.id === tab) ? tab : 'models';

  renderShell();
  await mountActiveTab(opts && opts.prefill);
}

/**
 * Unmount the Settings hub and any active sub-module.
 */
export function unmountSettings() {
  if (TAB_UNMOUNTERS[_activeTab]) {
    try { TAB_UNMOUNTERS[_activeTab](); } catch (_) {}
  }
  _mounted = false;
}

// ── Shell ──────────────────────────────────────────────────────────────

function renderShell() {
  const container = document.getElementById('view-container');
  if (!container) return;
  container.innerHTML = '';

  const header = el('div', { cls: 'section-header' });
  header.appendChild(el('h2', { cls: 'section-title', text: 'Settings' }));
  container.appendChild(header);

  // Tab bar
  const tabBar = el('div', { cls: 'settings-tabs', id: 'settings-tab-bar' });
  for (const tab of TABS) {
    const btn = el('button', {
      cls: `settings-tab${tab.id === _activeTab ? ' active' : ''}`,
      'data-tab': tab.id,
      text: tab.label,
    });
    btn.addEventListener('click', () => switchTab(tab.id));
    tabBar.appendChild(btn);
  }
  container.appendChild(tabBar);

  // Tab panel
  container.appendChild(el('div', { id: 'settings-panel', style: 'padding-top:14px' }));
}

// ── Tab switching ──────────────────────────────────────────────────────

/**
 * Switch to a different settings tab.
 * @param {string} tabId
 * @param {string} [prefill]
 */
async function switchTab(tabId, prefill) {
  if (!_mounted) return;

  // Unmount current tab module
  if (TAB_UNMOUNTERS[_activeTab]) {
    try { TAB_UNMOUNTERS[_activeTab](); } catch (_) {}
  }

  _activeTab = tabId;

  // Update tab button active state
  const tabBar = document.getElementById('settings-tab-bar');
  if (tabBar) {
    for (const btn of tabBar.querySelectorAll('.settings-tab')) {
      btn.classList.toggle('active', /** @type {HTMLElement} */ (btn).dataset.tab === tabId);
    }
  }

  // Clear panel and mount new tab
  const panel = document.getElementById('settings-panel');
  if (panel) panel.innerHTML = '';

  await mountActiveTab(prefill);
}

/**
 * Mount the currently active tab's content into #settings-panel.
 * @param {string} [prefill]
 */
async function mountActiveTab(prefill) {
  if (!_mounted) return;
  const panel = document.getElementById('settings-panel');
  if (!panel) return;

  switch (_activeTab) {
    case 'models':
      await mountModelsTab(panel);
      break;
    case 'connectors':
      if (prefill) prefillConnector(prefill);
      await mountMcp(panel);
      break;
    case 'ecosystem':
      await mountEcosystem(panel);
      break;
    case 'profiles':
      await mountProfilesTab(panel);
      break;
  }
}

// ── Models tab ─────────────────────────────────────────────────────────

/**
 * Mount the Models tab: tier microcopy + config editor + cache clear.
 * @param {HTMLElement} panel
 */
async function mountModelsTab(panel) {
  // Tier microcopy (§9.5)
  const tiers = el('div', { cls: 'config-journal-note', style: 'margin-bottom:12px' });

  const tierRows = [
    { label: 'simple',   note: 'High-volume mechanical work - keep it local/cheap.' },
    { label: 'moderate', note: 'Drafting and routine judgment.' },
    { label: 'complex',  note: 'Architecture and repair - the expensive one.' },
  ];
  for (const { label, note } of tierRows) {
    const row = el('div', { style: 'display:flex;gap:8px;align-items:baseline;margin-bottom:3px' });
    row.appendChild(el('span', { cls: 'chip chip-models', style: 'min-width:64px', text: label }));
    row.appendChild(el('span', { cls: 'dim', style: 'font-size:11px', text: note }));
    tiers.appendChild(row);
  }
  panel.appendChild(tiers);

  // Config knobs + cache-clear toolbar (existing module)
  await mountConfig(panel);
}

// ── Profiles tab ───────────────────────────────────────────────────────

/**
 * Mount the Profiles tab: preset cards with current highlighted, Apply button.
 * @param {HTMLElement} panel
 */
async function mountProfilesTab(panel) {
  // Load current preset from config
  let currentPreset = '';
  const project = get('currentProject');
  if (project) {
    try {
      const cfg = await somaJson(['config', 'get', '--json'], project);
      currentPreset = (cfg && cfg.preset) ? String(cfg.preset) : '';
    } catch (_) {}
  }

  const note = el('div', { cls: 'config-journal-note', style: 'margin-bottom:14px' });
  note.appendChild(el('span', { text: 'Re-applying overwrites routing, network and cache settings; your journal records the change.' }));
  panel.appendChild(note);

  const cards = el('div', { cls: 'preset-cards', id: 'profile-preset-cards' });
  for (const preset of PRESETS) {
    const isCurrent = preset.id === currentPreset || preset.name === currentPreset;
    const card = el('div', { cls: `preset-card${isCurrent ? ' current' : ''}` });

    const nameRow = el('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:4px' });
    nameRow.appendChild(el('div', { cls: 'preset-card-name', text: preset.name }));
    if (isCurrent) {
      nameRow.appendChild(el('span', { cls: 'chip chip-green', text: 'current' }));
    }
    card.appendChild(nameRow);
    card.appendChild(el('div', { cls: 'preset-card-desc', text: preset.desc }));

    const changesList = el('ul', { cls: 'preset-card-changes' });
    for (const change of preset.changes) {
      changesList.appendChild(el('li', { text: change }));
    }
    card.appendChild(changesList);

    // Command preview + Apply button
    const previewEl = cmdPreview(`soma preset apply ${preset.id}`);
    previewEl.style.marginTop = '8px';
    card.appendChild(previewEl);

    const applyBtn = el('button', { cls: 'btn btn-green', style: 'margin-top:6px', text: 'Apply' });
    applyBtn.addEventListener('click', () => handleApplyPreset(preset.id, applyBtn, panel));
    card.appendChild(applyBtn);

    cards.appendChild(card);
  }
  panel.appendChild(cards);
}

/**
 * @param {string} presetId
 * @param {HTMLButtonElement} btn
 * @param {HTMLElement} panel
 */
async function handleApplyPreset(presetId, btn, panel) {
  const project = get('currentProject');
  btn.disabled = true;
  const origText = btn.textContent;
  btn.textContent = 'Applying…';

  try {
    const result = await somaRaw(['preset', 'apply', presetId], project);
    const msg = result.stdout.trim() || result.stderr.trim() || `exit ${result.code}`;
    showToast(msg, result.code === 0 ? 'success' : 'error');
    if (result.code === 0) {
      triggerPollAndVerify();
      // Refresh profiles tab to reflect new current preset
      panel.innerHTML = '';
      await mountProfilesTab(panel);
    }
  } catch (e) {
    showToast(String(e), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function triggerPollAndVerify() {
  import('../app.js').then(({ triggerPollAndVerify: tpv }) => {
    if (typeof tpv === 'function') tpv();
  }).catch(() => {});
}
