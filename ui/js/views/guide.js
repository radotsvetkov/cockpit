/**
 * guide.js - Guide view (v5, UI-SPEC §9.6).
 *
 * Three sections:
 * 1. Getting-started checklist - 6 live-computed rows.
 * 2. FAQ accordion - verbatim copy from §9.6.
 * 3. What each view is for - cheat-sheet one-liners + keyboard map.
 *
 * Iron rules: no mutations here (read-only view); all checks are best-effort
 * (every probe wrapped in try/catch so no probe failure can blank the view).
 *
 * @module views/guide
 */

import { el, helpButton } from '../render.js';
import { get } from '../state.js';
import { modelProbe, listExports } from '../soma.js';
import { showToast } from './toast.js';

// ── State ────────────────────────────────────────────────────────

let _mounted = false;

// ── Checklist item definitions ───────────────────────────────────

/**
 * @typedef {Object} CheckItem
 * @property {string} title     - bold label for the row
 * @property {string} why       - one-line explanation shown dimly
 * @property {string} linkLabel - button label for the deep-link
 * @property {string} linkView  - view key passed to navigateTo
 * @property {string|null} linkTab  - tab key for settings deep-links (or null)
 * @property {() => Promise<boolean>} probe - async probe; resolves true = done
 */

/**
 * Build the checklist item definitions for the current project.
 * All probes are wrapped so they NEVER throw - they degrade to null (unknown).
 *
 * @param {string} project - current project root
 * @returns {CheckItem[]}
 */
function buildItems(project) {
  return [
    {
      title: 'Models reachable',
      why: 'soma needs at least one reachable provider to select and route model calls.',
      linkLabel: 'Open Settings · Models',
      linkView: 'settings',
      linkTab: 'models',
      probe: async () => {
        const results = await modelProbe(project);
        return Array.isArray(results) && results.some(r => r.ok === true);
      },
    },
    {
      title: 'Profile applied',
      why: 'A preset configures routing tiers, network stance and cache limits in one shot.',
      linkLabel: 'Open Settings · Profiles',
      linkView: 'settings',
      linkTab: 'profiles',
      probe: async () => {
        const invoke = window.__TAURI__.core.invoke;
        const raw = await invoke('run_soma', { args: ['config', 'get', '--json'], project });
        if (raw.code !== 0) return false;
        const cfg = JSON.parse((raw.stdout || '').trim() || '{}');
        return !!(cfg.preset && String(cfg.preset).trim() !== '');
      },
    },
    {
      title: 'First skill run',
      why: 'Running a skill proves the runtime is wired up and gives the selector data to learn from.',
      linkLabel: 'Open Skills',
      linkView: 'skills',
      linkTab: null,
      probe: async () => {
        const events = get('events') || [];
        return events.some(e => e.kind === 'skill.run');
      },
    },
    {
      title: 'Inbox reviewed',
      why: 'Applying or dismissing a proposal closes the autonomy loop - soma proposes, you decide.',
      linkLabel: 'Open Inbox',
      linkView: 'proposals',
      linkTab: null,
      probe: async () => {
        const events = get('events') || [];
        return events.some(e => e.kind === 'proposal.apply' || e.kind === 'proposal.dismiss');
      },
    },
    {
      title: 'Tool connected',
      why: 'MCP connectors give skills tools (files, web, memory) - they run locally under your policy.',
      linkLabel: 'Open Settings · Connectors',
      linkView: 'settings',
      linkTab: 'connectors',
      probe: async () => {
        const invoke = window.__TAURI__.core.invoke;
        const raw = await invoke('read_mcp', { root: project });
        const mcp = JSON.parse(typeof raw === 'string' ? raw : '{}');
        const servers = mcp.servers || mcp.mcpServers || {};
        return Object.keys(servers).length > 0;
      },
    },
    {
      title: 'Evidence exported',
      why: 'An export bundle is the signed artifact you hand an auditor - proof of what ran.',
      linkLabel: 'Open Evidence',
      linkView: 'exports',
      linkTab: null,
      probe: async () => {
        const entries = await listExports(project);
        return Array.isArray(entries) && entries.length > 0;
      },
    },
  ];
}

// ── FAQ entries ──────────────────────────────────────────────────

/**
 * @typedef {Object} FaqEntry
 * @property {string} q - italic question (summary element)
 * @property {string} a - verbatim answer from §9.6
 */

/** @type {FaqEntry[]} */
const FAQ = [
  {
    q: 'Why an autonomy ladder?',
    a: 'observe = soma only watches and suggests; assist = it prepares changes, you click Apply; auto = it applies mechanical fixes itself. Start at assist: you keep the handbrake while it does the work. Every rung change is journaled.',
  },
  {
    q: 'Local-only vs hybrid?',
    a: 'local-only = nothing leaves the machine - slower, fully private. hybrid = simple work stays local, hard work goes to a cloud model over an allowlisted host list you control. The footer shows which mode you\'re in, live.',
  },
  {
    q: 'Why three routing tiers?',
    a: 'So you only pay for hard problems. simple → small local model, moderate → cheap cloud, complex → frontier. Every routed call writes model.route with the factors - click one in the Timeline and the Why panel shows the math.',
  },
  {
    q: 'What is the journal?',
    a: 'An append-only file where every action lands, each entry hashed over the previous one (like git history). The ⛓ badge re-verifies it; edit one byte and it turns red at the exact line.',
  },
  {
    q: "What's in the Inbox?",
    a: 'Proposals - changes soma WANTS to make (skill repairs, config tweaks) with a model-written rationale and diff. Nothing applies without you at assist level.',
  },
  {
    q: 'Why connectors (MCP)?',
    a: 'They give skills tools - files, web, GitHub, memora. Servers run locally under your policy; importing a tool just creates a skill, and every call is policy-checked and journaled.',
  },
  {
    q: 'What is Evidence?',
    a: 'Signed, exportable proof of what ran: journal → OTLP → AGEF bundle → ed25519 signature. agef-verify checks it offline - that\'s the artifact you hand an auditor or client.',
  },
  {
    q: 'Where do API keys live?',
    a: 'In your shell environment (launchctl on macOS), never in the UI, never in config files, never in the journal (redaction strips matching keys before write).',
  },
  {
    q: 'Why does every form show a CLI command?',
    a: 'The UI holds no power of its own - it can only run what you could type. The preview IS the mutation, so you can audit before, and the journal after.',
  },
  {
    q: 'Keyboard?',
    a: '1–9,0 switch views, ? opens this guide.',
  },
];

// ── View cheat-sheet ─────────────────────────────────────────────

/**
 * @typedef {Object} ViewEntry
 * @property {string} name   - display name matching sidebar label
 * @property {string} desc   - one-liner
 */

/** @type {ViewEntry[]} */
const VIEW_LINES = [
  { name: 'Timeline',  desc: 'every action, hash-chained, with a Why panel' },
  { name: 'Sessions',  desc: 'full agent runs delegated to akmon, with evidence' },
  { name: 'Evidence',  desc: 'signed bundles an auditor can verify offline' },
  { name: 'Skills',    desc: 'the commands soma can run, with track records' },
  { name: 'Goals',     desc: 'multi-step outcomes with acceptance criteria' },
  { name: 'Crons',     desc: 'schedules that fire skills and goals' },
  { name: 'Inbox',     desc: 'changes soma proposes - you decide' },
  { name: 'Policy',    desc: 'the autonomy contract: what may run, where data may go' },
  { name: 'Settings',  desc: 'models, connectors, ecosystem, profiles' },
  { name: 'Guide',     desc: 'this page' },
];

// ── Mount / Unmount ──────────────────────────────────────────────

/**
 * Mount the Guide view into #view-container.
 * Renders shell immediately, then runs probes asynchronously.
 */
export function mountGuide() {
  _mounted = true;
  const container = document.getElementById('view-container');
  if (!container) return;
  container.innerHTML = '';

  // ── Header ──
  const header = el('div', { cls: 'section-header' });
  const titleRow = el('div', { style: 'display:flex;align-items:center;gap:8px;' });
  titleRow.appendChild(el('h2', { cls: 'section-title', text: 'Guide' }));
  titleRow.appendChild(
    helpButton('Guide', [
      'Orientation page for soma cockpit.',
      'Use the checklist to confirm the runtime is wired up; read the FAQ for mental-model answers; the cheat-sheet lists every view in one line.',
      'Keyboard: 1–9 and 0 switch views; ? reopens this page.',
    ])
  );
  header.appendChild(titleRow);

  // Refresh button
  const refreshBtn = el('button', { cls: 'btn btn-sm', style: 'margin-left:auto;', text: '↺ Refresh checks' });
  header.appendChild(refreshBtn);
  container.appendChild(header);

  // ── Section 1: Checklist ──
  const checkSection = el('section', { cls: 'guide-section', style: 'margin-top:20px;' });
  checkSection.appendChild(el('h3', { cls: 'guide-section-title', text: 'Getting started' }));

  const checkList = el('ul', { cls: 'guide-checklist', style: 'list-style:none;padding:0;margin:0;' });
  checkSection.appendChild(checkList);
  container.appendChild(checkSection);

  // ── Section 2: FAQ ──
  const faqSection = el('section', { cls: 'guide-section', style: 'margin-top:28px;' });
  faqSection.appendChild(el('h3', { cls: 'guide-section-title', text: 'FAQ' }));
  for (const entry of FAQ) {
    faqSection.appendChild(buildFaqItem(entry));
  }
  container.appendChild(faqSection);

  // ── Section 3: View cheat-sheet ──
  const sheetSection = el('section', { cls: 'guide-section', style: 'margin-top:28px;' });
  sheetSection.appendChild(el('h3', { cls: 'guide-section-title', text: 'What each view is for' }));
  const dl = el('dl', { cls: 'guide-viewlist', style: 'margin:0;' });
  for (const v of VIEW_LINES) {
    const dt = el('dt', { cls: 'guide-view-name', text: v.name });
    const dd = el('dd', { cls: 'guide-view-desc dim', text: v.desc });
    dl.appendChild(dt);
    dl.appendChild(dd);
  }
  sheetSection.appendChild(dl);

  const kbNote = el('p', { cls: 'dim', style: 'margin-top:12px;font-size:11px;', text: 'Keyboard shortcuts: 1–9 jump to views in sidebar order (Timeline→Settings); 0 opens Guide; ? opens Guide from anywhere. Disabled when focus is in a text field.' });
  sheetSection.appendChild(kbNote);
  container.appendChild(sheetSection);

  // Wire refresh button
  refreshBtn.addEventListener('click', () => {
    runChecks(checkList);
  });

  // Run checks initially
  runChecks(checkList);
}

/**
 * Unmount the Guide view.
 */
export function unmountGuide() {
  _mounted = false;
}

// ── Checklist rendering ──────────────────────────────────────────

/**
 * Render placeholder skeleton rows into the checklist, then fire all probes
 * via Promise.allSettled and update each row in place.
 *
 * @param {HTMLElement} listEl - the <ul> element to populate
 */
async function runChecks(listEl) {
  if (!listEl) return;
  listEl.innerHTML = '';

  const project = get('currentProject');

  // Render placeholder rows first so UI is never blank
  /** @type {Array<{dotEl: HTMLElement, whyEl: HTMLElement}>} */
  const rows = [];

  // Items depend on project; if no project, show a note and bail
  if (!project) {
    const li = el('li', { cls: 'check-item', style: 'padding:8px 0;color:var(--fg-dim);' });
    li.appendChild(el('span', { cls: 'check-dot dim', text: '○' }));
    li.appendChild(el('span', { style: 'margin-left:8px;', text: 'No project selected - open a project to run checks.' }));
    listEl.appendChild(li);
    return;
  }

  const items = buildItems(project);

  for (const item of items) {
    const li = el('li', { cls: 'check-item', style: 'display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);' });

    const dotEl = el('span', { cls: 'check-dot dim', style: 'flex-shrink:0;font-size:16px;width:18px;text-align:center;color:var(--fg-dim);', text: '○' });
    li.appendChild(dotEl);

    const body = el('div', { style: 'flex:1;min-width:0;' });
    body.appendChild(el('span', { style: 'font-weight:600;', text: item.title }));

    const whyEl = el('span', { cls: 'dim', style: 'margin-left:6px;font-size:12px;', text: '…checking' });
    body.appendChild(whyEl);

    // Deep-link button
    const linkBtn = el('button', { cls: 'btn btn-sm', style: 'margin-top:4px;font-size:11px;display:block;', text: item.linkLabel });
    linkBtn.addEventListener('click', () => {
      import('../app.js').then(m => {
        if (item.linkTab) {
          m.navigateTo(item.linkView, { tab: item.linkTab });
        } else {
          m.navigateTo(item.linkView);
        }
      }).catch(err => {
        showToast(`Navigation error: ${err}`, 'error');
      });
    });
    body.appendChild(linkBtn);

    li.appendChild(body);
    listEl.appendChild(li);
    rows.push({ dotEl, whyEl });
  }

  // Run all probes concurrently; update rows as results come in
  const promises = items.map((item, i) => {
    return (async () => {
      try {
        const ok = await item.probe();
        updateRow(rows[i], ok, item.why, null);
      } catch (err) {
        updateRow(rows[i], null, item.why, String(err));
      }
    })();
  });

  await Promise.allSettled(promises);
}

/**
 * Update a checklist row with the probe result.
 *
 * @param {{ dotEl: HTMLElement, whyEl: HTMLElement }} row
 * @param {boolean|null} ok     - true = done, false = not yet, null = unknown
 * @param {string} why          - the one-line why text
 * @param {string|null} errNote - error message if probe threw
 */
function updateRow(row, ok, why, errNote) {
  if (!row) return;
  if (ok === true) {
    row.dotEl.textContent = '✓';
    row.dotEl.style.color = 'var(--green, #3fb950)';
    row.dotEl.classList.remove('dim');
    row.whyEl.textContent = why;
  } else if (errNote) {
    row.dotEl.textContent = '○';
    row.dotEl.style.color = '';
    row.dotEl.classList.add('dim');
    row.whyEl.textContent = 'could not check - ' + errNote.slice(0, 80);
  } else {
    row.dotEl.textContent = '○';
    row.dotEl.style.color = '';
    row.dotEl.classList.add('dim');
    row.whyEl.textContent = why;
  }
}

// ── FAQ accordion ────────────────────────────────────────────────

/**
 * Build one FAQ <details> accordion item.
 *
 * @param {FaqEntry} entry
 * @returns {HTMLDetailsElement}
 */
function buildFaqItem(entry) {
  const details = el('details', { cls: 'faq-item', style: 'margin-bottom:4px;border:1px solid var(--border);border-radius:4px;' });
  const summary = el('summary', { cls: 'faq-summary', style: 'cursor:pointer;padding:8px 12px;font-style:italic;user-select:none;', text: entry.q });
  const body = el('p', { cls: 'faq-body', style: 'padding:8px 12px 10px;margin:0;line-height:1.5;', text: entry.a });
  details.appendChild(summary);
  details.appendChild(body);
  return details;
}
