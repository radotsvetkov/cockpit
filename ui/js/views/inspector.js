/**
 * inspector.js - Right drawer: event inspector with Why panel renderers (U4).
 *
 * Handles: select.explain, model.route, policy.decision, select.rerank.
 * Unknown kinds: renders generic def-list + raw JSON. Never crashes.
 *
 * @module views/inspector
 */

import { el, kindChip, fmtTime, fmtTimeFull, truncHash, rawJsonDetails, svgBars, jsonPretty } from '../render.js';
import { get, setState } from '../state.js';

/**
 * Open the inspector drawer with the given event.
 * @param {object} event - parsed journal event
 */
export function openInspector(event) {
  setState({ inspectorEvent: event });
  const drawer = document.getElementById('inspector-drawer');
  if (drawer) drawer.classList.remove('closed');
  renderInspector(event);
}

/**
 * Close the inspector drawer.
 */
export function closeInspector() {
  setState({ inspectorEvent: null });
  const drawer = document.getElementById('inspector-drawer');
  if (drawer) drawer.classList.add('closed');
}

/**
 * Mount the inspector close button.
 */
export function mountInspector() {
  document.getElementById('drawer-close').addEventListener('click', closeInspector);
}

/**
 * Render the inspector content for an event.
 * @param {object} event
 */
function renderInspector(event) {
  const titleEl  = document.getElementById('drawer-title');
  const contentEl = document.getElementById('drawer-content');
  if (!titleEl || !contentEl) return;

  const kind = event.kind || '?';
  const ts   = event.t || event.ts;

  // Header title
  titleEl.innerHTML = '';
  titleEl.appendChild(kindChip(kind));
  if (event.id) {
    titleEl.appendChild(el('span', { cls: 'dim mono', style: 'margin-left:6px;font-size:10px', text: String(event.id).slice(0, 12) }));
  }

  contentEl.innerHTML = '';

  // ── Why section ──────────────────────────────────────────────────
  const whySec = renderWhySection(event);
  if (whySec) contentEl.appendChild(whySec);

  // ── Time + id ──────────────────────────────────────────────────
  const metaSection = el('div', { cls: 'inspector-section' });
  metaSection.appendChild(el('div', { cls: 'inspector-section-title', text: 'Event' }));
  const dl = el('dl', { cls: 'def-list' });
  if (ts) {
    appendDef(dl, 'time', `${fmtTimeFull(ts)} (${fmtTime(ts)})`);
  }
  if (event.id)   appendDef(dl, 'id',   String(event.id));
  if (event.kind) appendDef(dl, 'kind', event.kind);
  metaSection.appendChild(dl);
  contentEl.appendChild(metaSection);

  // ── Payload fields ────────────────────────────────────────────
  const payloadSection = renderPayloadSection(event);
  if (payloadSection) contentEl.appendChild(payloadSection);

  // ── Chain row ────────────────────────────────────────────────
  const chainSection = renderChainSection(event);
  if (chainSection) contentEl.appendChild(chainSection);

  // ── Raw JSON ─────────────────────────────────────────────────
  const rawSection = el('div', { cls: 'inspector-section' });
  rawSection.appendChild(rawJsonDetails(event));
  contentEl.appendChild(rawSection);
}

/**
 * Render the "Why" section for explainable event kinds.
 * Returns null for unknown kinds (never crashes).
 *
 * @param {object} event
 * @returns {HTMLElement|null}
 */
function renderWhySection(event) {
  const kind = event.kind || '';
  const d = event.data || event;

  // A Why renderer must never blank the whole drawer: any error degrades
  // to a note, and the payload/raw-JSON sections below still render.
  try {
    if (kind === 'select.explain') return renderSelectExplain(event, d);
    if (kind === 'model.route')    return renderModelRoute(event, d);
    if (kind === 'policy.decision') return renderPolicyDecision(event, d);
    if (kind === 'select.rerank')  return renderSelectRerank(event, d);
    return null;
  } catch (e) {
    const sec = el('div', { cls: 'inspector-section' });
    sec.appendChild(el('div', { cls: 'inspector-section-title', text: 'Why' }));
    sec.appendChild(el('div', { cls: 'dim', style: 'font-size:11px', text: `renderer error (${e.message}) - see raw JSON below` }));
    return sec;
  }
}

/**
 * @param {object} event
 * @param {object} d - event.data or event itself
 * @returns {HTMLElement}
 */
function renderSelectExplain(event, d) {
  const sec = el('div', { cls: 'inspector-section' });
  sec.appendChild(el('div', { cls: 'inspector-section-title', text: 'Why - Skill Selection' }));

  // Two shapes exist (UI-SPEC U4 renders the JOURNALED one):
  //  - journal event: chosen=string, score, factors=[...] (winner's), candidates=COUNT
  //  - select --json: candidates=[{name,score,factors}...]
  const candidates = Array.isArray(d.candidates) ? d.candidates.slice() : [];
  if (candidates.length === 0 && Array.isArray(d.factors)) {
    candidates.push({ name: d.chosen || '?', score: d.score, factors: d.factors });
  }
  const chosen = (typeof d.chosen === 'string' && d.chosen) ||
    (d.chosen && d.chosen.name) || (candidates[0] && candidates[0].name);
  const runnerUp = candidates.length > 1 ? candidates[1] : null;

  if (chosen) {
    sec.appendChild(el('div', { cls: 'why-winner-label', text: `✓ Selected: ${chosen}` }));
  }
  if (runnerUp) {
    sec.appendChild(el('div', { cls: 'dim', style: 'font-size:11px;margin-bottom:8px', text: `Runner-up: ${runnerUp.name} (score ${typeof runnerUp.score === 'number' ? runnerUp.score.toFixed(3) : runnerUp.score})` }));
  }

  // Factor bars for each candidate
  for (const cand of candidates) {
    const isWinner = cand.name === chosen;
    const candWrap = el('div', { style: `margin-bottom:12px;padding:8px;background:var(--panel2);border:1px solid var(--border);border-radius:6px;${isWinner ? 'border-color:var(--green)' : ''}` });
    const candHeader = el('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:6px' });
    candHeader.appendChild(el('span', { style: `font-size:12px;font-weight:600;${isWinner ? 'color:var(--green)' : ''}`, text: cand.name }));
    if (typeof cand.score === 'number') {
      candHeader.appendChild(el('span', { cls: 'dim mono', style: 'font-size:10px', text: `score: ${cand.score.toFixed(3)}` }));
    }
    if (cand.kind)   candHeader.appendChild(el('span', { cls: 'chip chip-skills', style: 'font-size:9px', text: cand.kind }));
    if (cand.origin) candHeader.appendChild(el('span', { cls: 'chip chip-gray',   style: 'font-size:9px', text: cand.origin }));
    candWrap.appendChild(candHeader);

    if (cand.factors && cand.factors.length > 0) {
      candWrap.appendChild(svgBars(cand.factors, isWinner ? cand.name : null));
    }
    sec.appendChild(candWrap);
  }

  // Task + how wide the field was (journal shape carries a count)
  if (d.task) {
    sec.appendChild(el('div', { cls: 'dim', style: 'font-size:11px', text: `Task: ${d.task}` }));
  }
  if (typeof d.candidates === 'number') {
    sec.appendChild(el('div', { cls: 'dim', style: 'font-size:11px', text: `${d.candidates} candidates considered` }));
  }
  return sec;
}

/**
 * @param {object} event
 * @param {object} d
 * @returns {HTMLElement}
 */
function renderModelRoute(event, d) {
  const sec = el('div', { cls: 'inspector-section' });
  sec.appendChild(el('div', { cls: 'inspector-section-title', text: 'Why - Model Routing' }));

  // Difficulty pill - runtime field is `level`
  const difficulty = d.level || '?';
  const diffCls = { simple: 'difficulty-simple', moderate: 'difficulty-moderate', complex: 'difficulty-complex' }[difficulty] || 'difficulty-simple';
  const diffRow = el('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:10px' });
  diffRow.appendChild(el('span', { cls: `difficulty-pill ${diffCls}`, text: difficulty }));
  if (typeof d.points === 'number') {
    diffRow.appendChild(el('span', { cls: 'dim mono', style: 'font-size:11px', text: `${d.points} pts` }));
  }
  sec.appendChild(diffRow);

  // Factor list with points - runtime factor shape: {factor, points}
  if (d.factors && d.factors.length > 0) {
    const factorList = el('div', { cls: 'why-bars', style: 'margin-bottom:10px' });
    for (const f of d.factors) {
      const row = el('div', { style: 'display:flex;align-items:center;gap:8px;font-size:11px;padding:2px 0' });
      if (typeof f.points === 'number') {
        row.appendChild(el('span', { cls: 'mono', style: `color:${f.points >= 0 ? 'var(--green)' : 'var(--red)'};min-width:32px`, text: `${f.points >= 0 ? '+' : ''}${f.points}` }));
      }
      row.appendChild(el('span', { cls: 'dim', text: f.factor || '' }));
      factorList.appendChild(row);
    }
    sec.appendChild(factorList);
  }

  // Chosen provider/model
  const chosenRow = el('div', { style: 'margin-bottom:6px' });
  chosenRow.appendChild(el('span', { cls: 'dim', style: 'font-size:11px', text: 'Chosen: ' }));
  chosenRow.appendChild(el('span', { cls: 'mono green', style: 'font-size:12px', text: `${d.provider || '?'} / ${d.model || '?'}` }));
  sec.appendChild(chosenRow);

  // Fallback
  if (d.fallback_from) {
    sec.appendChild(el('div', { cls: 'amber', style: 'font-size:11px', text: `Fallback from: ${d.fallback_from}` }));
  }

  // Task - runtime field is `task_excerpt`
  if (d.task_excerpt) {
    sec.appendChild(el('div', { cls: 'dim', style: 'font-size:11px;margin-top:4px', text: `Task: ${d.task_excerpt}` }));
  }
  return sec;
}

/**
 * @param {object} event
 * @param {object} d
 * @returns {HTMLElement}
 */
function renderPolicyDecision(event, d) {
  const sec = el('div', { cls: 'inspector-section' });
  sec.appendChild(el('div', { cls: 'inspector-section-title', text: 'Why - Policy Decision' }));

  // Journal shape: {subject, allowed, rule}
  const allowed = d.allowed === true || d.allow === true || d.allow === 'true';
  const pill = el('span', { cls: `allow-pill ${allowed ? 'allow' : 'deny'}`, text: allowed ? '✓ ALLOW' : '✕ DENY' });
  sec.appendChild(pill);

  if (d.rule || d.pattern) {
    const ruleWrap = el('div', { style: 'margin-top:10px' });
    ruleWrap.appendChild(el('div', { cls: 'dim', style: 'font-size:10px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px', text: 'Rule pattern' }));
    ruleWrap.appendChild(el('code', { style: 'display:block;padding:4px 8px;font-size:11px;word-break:break-all', text: d.rule || d.pattern }));
    sec.appendChild(ruleWrap);
  }

  const subject = d.subject || d.action;
  if (subject) {
    const actionWrap = el('div', { style: 'margin-top:8px' });
    actionWrap.appendChild(el('div', { cls: 'dim', style: 'font-size:10px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px', text: 'Action attempted' }));
    actionWrap.appendChild(el('code', { style: 'display:block;padding:4px 8px;font-size:11px;word-break:break-all', text: subject }));
    sec.appendChild(actionWrap);
  }

  return sec;
}

/**
 * @param {object} event
 * @param {object} d
 * @returns {HTMLElement}
 */
function renderSelectRerank(event, d) {
  const sec = el('div', { cls: 'inspector-section' });
  sec.appendChild(el('div', { cls: 'inspector-section-title', text: 'Why - Reranking' }));

  // Runtime journals: {task, note, reply_excerpt?}
  if (d.task) {
    sec.appendChild(el('div', { cls: 'dim', style: 'font-size:11px;margin-bottom:6px', text: `Task: ${d.task}` }));
  }

  if (d.note) {
    const noteWrap = el('div', { style: 'padding:8px;background:var(--panel2);border:1px solid var(--border);border-radius:6px;font-size:12px;margin-bottom:6px' });
    noteWrap.appendChild(el('span', { text: d.note }));
    sec.appendChild(noteWrap);
  }

  if (d.reply_excerpt) {
    const excerptWrap = el('div', { style: 'margin-top:6px' });
    excerptWrap.appendChild(el('div', { cls: 'dim', style: 'font-size:10px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px', text: 'Model reply excerpt' }));
    excerptWrap.appendChild(el('code', { style: 'display:block;padding:4px 8px;font-size:11px;word-break:break-all', text: d.reply_excerpt }));
    sec.appendChild(excerptWrap);
  }

  return sec;
}

/**
 * Render payload fields as a definition list, skipping structural/meta fields.
 * @param {object} event
 * @returns {HTMLElement|null}
 */
function renderPayloadSection(event) {
  const SKIP = new Set(['kind', 'id', 't', 'ts', 'prev', 'hash', 'data']);
  const pairs = [];

  // Top-level non-structural fields
  for (const [k, v] of Object.entries(event)) {
    if (SKIP.has(k)) continue;
    pairs.push([k, v]);
  }

  // If there's a nested 'data' object, unpack it too
  if (event.data && typeof event.data === 'object' && !Array.isArray(event.data)) {
    for (const [k, v] of Object.entries(event.data)) {
      if (!SKIP.has(k)) pairs.push([`data.${k}`, v]);
    }
  }

  if (pairs.length === 0) return null;

  const sec = el('div', { cls: 'inspector-section' });
  sec.appendChild(el('div', { cls: 'inspector-section-title', text: 'Payload' }));
  const dl = el('dl', { cls: 'def-list' });
  for (const [k, v] of pairs) {
    const vStr = typeof v === 'object' ? jsonPretty(v) : String(v);
    appendDef(dl, k, vStr);
  }
  sec.appendChild(dl);
  return sec;
}

/**
 * Render the prev/hash chain row.
 * @param {object} event
 * @returns {HTMLElement|null}
 */
function renderChainSection(event) {
  if (!event.prev && !event.hash) return null;

  const sec = el('div', { cls: 'inspector-section' });
  sec.appendChild(el('div', { cls: 'inspector-section-title', text: 'Chain' }));

  const row = el('div', { cls: 'chain-row' });

  if (event.prev) {
    const prevLabel = el('span', { cls: 'dim', style: 'font-size:10px', text: 'prev: ' });
    const prevLink = el('a', {
      href: '#',
      title: event.prev,
      style: 'font-size:10px',
      text: truncHash(event.prev),
    });
    prevLink.addEventListener('click', (e) => {
      e.preventDefault();
      jumpToPrev(event.prev);
    });
    row.appendChild(prevLabel);
    row.appendChild(prevLink);
  }

  if (event.hash) {
    row.appendChild(el('span', { cls: 'dim', style: 'margin:0 8px;font-size:10px', text: '→' }));
    row.appendChild(el('span', { cls: 'dim', style: 'font-size:10px', text: 'hash: ' }));
    row.appendChild(el('span', { cls: 'mono', title: event.hash, style: 'font-size:10px', text: truncHash(event.hash) }));
  }

  sec.appendChild(row);
  return sec;
}

/**
 * Jump to the event whose hash matches prevHash (scroll in timeline).
 * @param {string} prevHash
 */
function jumpToPrev(prevHash) {
  const events = get('events');
  const target = events.find(ev => ev.hash === prevHash);
  if (!target) {
    // Show a tooltip/toast that it's outside the loaded window
    const { showToast } = {};
    // We dynamically import to avoid circular issues
    import('./toast.js').then(({ showToast: st }) => {
      st(`Event with hash ${truncHash(prevHash)} is outside the loaded window (1 MiB limit).`, 'info');
    });
    return;
  }
  openInspector(target);
  // Try to scroll the timeline row into view
  const el2 = document.querySelector(`[data-event-id="${target.id || target.hash}"]`);
  if (el2) el2.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/**
 * Append a dt/dd pair to a definition list.
 * @param {HTMLDListElement} dl
 * @param {string} key
 * @param {string} value
 */
function appendDef(dl, key, value) {
  dl.appendChild(el('dt', { cls: 'def-key', text: key }));
  dl.appendChild(el('dd', { cls: 'def-val', text: value }));
}
