/**
 * render.js - Shared DOM/SVG helpers for soma cockpit.
 *
 * No framework. Pure functions only. Nothing here touches the Tauri IPC.
 *
 * @module render
 */

/**
 * Create a DOM element with optional attributes, classes, and children.
 *
 * @param {string} tag
 * @param {Object} [attrs={}] - attribute map; 'cls' → className; 'style' → style string; others set as attributes
 * @param {...(Node|string|null|undefined)} children
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (k === 'cls')   { e.className = v; }
    else if (k === 'style') { e.style.cssText = v; }
    else if (k === 'text')  { e.textContent = v; }
    else if (k === 'html')  { e.innerHTML = v; }
    else if (k.startsWith('on')) {
      e.addEventListener(k.slice(2).toLowerCase(), v);
    }
    else { e.setAttribute(k, v); }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    if (typeof child === 'string' || typeof child === 'number') {
      e.appendChild(document.createTextNode(String(child)));
    } else if (child instanceof Node) {
      e.appendChild(child);
    }
  }
  return e;
}

/**
 * Format a timestamp (ISO string or ms integer or unix-s integer)
 * to a short relative string, falling back to ISO.
 *
 * @param {string|number|undefined} ts
 * @returns {string}
 */
export function fmtTime(ts) {
  if (ts === null || ts === undefined) return '-';
  let ms;
  if (typeof ts === 'string') {
    ms = Date.parse(ts);
  } else if (typeof ts === 'number') {
    // Heuristic: unix-s if < 1e12, else ms
    ms = ts < 1e12 ? ts * 1000 : ts;
  } else {
    return '-';
  }
  if (isNaN(ms)) return String(ts);
  const diff = Date.now() - ms;
  if (diff < 0)     return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
  if (diff < 60000)  return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  if (diff < 7 * 86400000) return `${Math.round(diff / 86400000)}d ago`;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Format a timestamp as a full ISO-like string for tooltips.
 * @param {string|number|undefined} ts
 * @returns {string}
 */
export function fmtTimeFull(ts) {
  if (ts === null || ts === undefined) return '-';
  let ms;
  if (typeof ts === 'string') {
    ms = Date.parse(ts);
  } else if (typeof ts === 'number') {
    ms = ts < 1e12 ? ts * 1000 : ts;
  } else {
    return '-';
  }
  if (isNaN(ms)) return String(ts);
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 23) + 'Z';
}

/**
 * @typedef {Object} AreaInfo
 * @property {string} area   - canonical area name
 * @property {string} label  - display label
 * @property {string} cls    - CSS class for the chip
 */

/** Map of event kind prefix → area info */
const KIND_AREA_MAP = {
  'project.init':      { area: 'project',   label: 'Project & policy', cls: 'chip-project' },
  'preset.apply':      { area: 'project',   label: 'Project & policy', cls: 'chip-project' },
  'policy.change':     { area: 'project',   label: 'Project & policy', cls: 'chip-project' },
  'config.change':     { area: 'project',   label: 'Project & policy', cls: 'chip-project' },
  'policy.decision':   { area: 'project',   label: 'Project & policy', cls: 'chip-project' },
  'skill.add':         { area: 'skills',    label: 'Skills',           cls: 'chip-skills'  },
  'skill.run':         { area: 'skills',    label: 'Skills',           cls: 'chip-skills'  },
  'skill.issue':       { area: 'skills',    label: 'Skills',           cls: 'chip-skills'  },
  'select.explain':    { area: 'selection', label: 'Selection',        cls: 'chip-selection' },
  'select.rerank':     { area: 'selection', label: 'Selection',        cls: 'chip-selection' },
  'model.route':       { area: 'models',    label: 'Models & cache',   cls: 'chip-models'  },
  'model.call':        { area: 'models',    label: 'Models & cache',   cls: 'chip-models'  },
  'cache.clear':       { area: 'models',    label: 'Models & cache',   cls: 'chip-models'  },
  'goal.add':          { area: 'goals',     label: 'Goals',            cls: 'chip-goals'   },
  'goal.step.add':     { area: 'goals',     label: 'Goals',            cls: 'chip-goals'   },
  'goal.step':         { area: 'goals',     label: 'Goals',            cls: 'chip-goals'   },
  'goal.run':          { area: 'goals',     label: 'Goals',            cls: 'chip-goals'   },
  'goal.done':         { area: 'goals',     label: 'Goals',            cls: 'chip-goals'   },
  'cron.add':          { area: 'crons',     label: 'Crons',            cls: 'chip-crons'   },
  'cron.toggle':       { area: 'crons',     label: 'Crons',            cls: 'chip-crons'   },
  'cron.run':          { area: 'crons',     label: 'Crons',            cls: 'chip-crons'   },
  'tick.run':          { area: 'crons',     label: 'Crons',            cls: 'chip-crons'   },
  'proposal.new':      { area: 'improve',   label: 'Improvement',      cls: 'chip-improve' },
  'proposal.apply':    { area: 'improve',   label: 'Improvement',      cls: 'chip-improve' },
  'proposal.dismiss':  { area: 'improve',   label: 'Improvement',      cls: 'chip-improve' },
  'optimize.run':      { area: 'improve',   label: 'Improvement',      cls: 'chip-improve' },
  'knowledge.add':     { area: 'improve',   label: 'Improvement',      cls: 'chip-improve' },
  'mcp.rpc':           { area: 'mcp',       label: 'MCP',              cls: 'chip-mcp'     },
  'mcp.import':        { area: 'mcp',       label: 'MCP',              cls: 'chip-mcp'     },
  'mcp.add':           { area: 'mcp',       label: 'MCP',              cls: 'chip-mcp'     },
  'mcp.remove':        { area: 'mcp',       label: 'MCP',              cls: 'chip-mcp'     },
  'wrap.start':        { area: 'wrap',      label: 'Wrapped agents',   cls: 'chip-wrap'    },
  'wrap.end':          { area: 'wrap',      label: 'Wrapped agents',   cls: 'chip-wrap'    },
  'export.bundle':     { area: 'evidence',  label: 'Evidence',         cls: 'chip-evidence'},
  'journal.anchor':    { area: 'evidence',  label: 'Evidence',         cls: 'chip-evidence'},
};

/**
 * Get area info for an event kind.
 * Unknown kinds return the 'unknown' fallback - never crashes.
 *
 * @param {string} kind
 * @returns {AreaInfo & {kind: string}}
 */
export function kindArea(kind) {
  if (!kind) return { area: 'unknown', label: 'Unknown', cls: 'chip-unknown', kind: '' };
  const info = KIND_AREA_MAP[kind];
  if (info) return { ...info, kind };
  // Partial match fallback (future kinds with same prefix)
  for (const [prefix, data] of Object.entries(KIND_AREA_MAP)) {
    if (kind.startsWith(prefix.split('.')[0] + '.')) return { ...data, kind };
  }
  return { area: 'unknown', label: 'Unknown', cls: 'chip-unknown', kind };
}

/**
 * All distinct areas for filter chips.
 * @returns {Array<{area:string, label:string, cls:string}>}
 */
export function allAreas() {
  const seen = new Set();
  const out = [];
  for (const v of Object.values(KIND_AREA_MAP)) {
    if (!seen.has(v.area)) {
      seen.add(v.area);
      out.push({ area: v.area, label: v.label, cls: v.cls });
    }
  }
  return out;
}

/**
 * Create a kind chip element.
 * @param {string} kind
 * @returns {HTMLElement}
 */
export function kindChip(kind) {
  const info = kindArea(kind);
  return el('span', { cls: `chip ${info.cls}`, title: info.label }, kind || '?');
}

/**
 * Render an SVG sparkline from an array of boolean values (true=ok, false=fail).
 * Returns an SVGSVGElement.
 *
 * @param {boolean[]} values - array of ok/fail booleans (oldest first)
 * @param {number} [width=80]
 * @param {number} [height=16]
 * @returns {SVGSVGElement}
 */
export function svgSparkline(values, width = 80, height = 16) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('aria-hidden', 'true');

  if (!values || values.length === 0) return svg;

  const n = values.length;
  const gap = 2;
  const tickW = Math.max(2, Math.floor((width - gap * (n - 1)) / n));
  const totalW = n * tickW + (n - 1) * gap;
  const startX = Math.floor((width - totalW) / 2);

  for (let i = 0; i < n; i++) {
    const x = startX + i * (tickW + gap);
    const rect = document.createElementNS(ns, 'rect');
    rect.setAttribute('x', String(x));
    rect.setAttribute('y', '2');
    rect.setAttribute('width', String(tickW));
    rect.setAttribute('height', String(height - 4));
    rect.setAttribute('rx', '1');
    rect.setAttribute('fill', values[i] ? '#3fb950' : '#f85149');
    svg.appendChild(rect);
  }
  return svg;
}

/**
 * Render SVG horizontal bars for factor visualization (select.explain, etc.)
 * Each factor has {name, value, note}. value is normalized 0..1.
 * Returns a <div> element.
 *
 * @param {Array<{name:string, value:number, note:string}>} factors
 * @param {string} [winnerId] - name of the winning factor row to highlight
 * @returns {HTMLElement}
 */
export function svgBars(factors, winnerId = null) {
  const wrap = el('div', { cls: 'why-bars' });
  if (!factors || factors.length === 0) {
    wrap.appendChild(el('span', { cls: 'dim', text: 'No factors' }));
    return wrap;
  }
  // Normalize values to 0–1 range
  const maxVal = Math.max(...factors.map(f => Math.abs(f.value || 0)), 1);
  for (const f of factors) {
    const pct = Math.min(100, Math.round(Math.abs((f.value || 0) / maxVal) * 100));
    const isWinner = winnerId && f.name === winnerId;
    const row = el('div', { cls: 'why-bar-row' });
    const labelRow = el('div', { cls: 'why-bar-label' });
    labelRow.appendChild(el('span', { cls: 'why-bar-name', text: f.name || '?' }));
    labelRow.appendChild(el('span', { cls: 'why-bar-value', text: String(typeof f.value === 'number' ? f.value.toFixed(3) : (f.value || '')) }));
    row.appendChild(labelRow);

    const track = el('div', { cls: 'why-bar-track' });
    const fill = el('div', { cls: `why-bar-fill${isWinner ? ' winner' : ''}`, style: `width:${pct}%` });
    track.appendChild(fill);
    row.appendChild(track);

    if (f.note) {
      row.appendChild(el('div', { cls: 'why-bar-note', text: f.note }));
    }
    wrap.appendChild(row);
  }
  return wrap;
}

/**
 * Pretty-print a JSON value as a string with 2-space indent.
 * @param {any} obj
 * @returns {string}
 */
export function jsonPretty(obj) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch (_) {
    return String(obj);
  }
}

/**
 * Create a <details class="raw-json"> element with pretty-printed JSON.
 * @param {any} obj
 * @param {string} [summary='Raw JSON']
 * @returns {HTMLDetailsElement}
 */
export function rawJsonDetails(obj, summary = 'Raw JSON') {
  const d = el('details', { cls: 'raw-json' });
  d.appendChild(el('summary', { text: summary }));
  d.appendChild(el('pre', { cls: 'json-pretty', text: jsonPretty(obj) }));
  return d;
}

/**
 * Extract a one-line human summary from a journal event.
 * Best-effort: falls back to an empty string for unknown kinds.
 *
 * @param {object} event
 * @returns {string}
 */
export function eventSummary(event) {
  if (!event) return '';
  const k = event.kind || '';
  const d = event.data || event; // some events are flat

  switch (k) {
    case 'skill.run':
      return `${d.skill || d.name || '?'} - ${d.ok ? 'ok' : 'failed'}${d.ms ? ` (${d.ms}ms)` : ''}`;
    case 'skill.add':
      return `added skill: ${d.name || d.skill || '?'}`;
    case 'skill.issue':
      return `issue on ${d.skill || '?'}: ${d.kind || ''}`;
    case 'select.explain':
      return `selected ${d.chosen || d.winner || '?'}${d.task ? ` for "${String(d.task).slice(0,40)}"` : ''}`;
    case 'select.rerank':
      return `reranked candidates${d.task ? ` for "${String(d.task).slice(0,30)}"` : ''}`;
    case 'model.route':
      return `${d.level || '?'} → ${d.provider || '?'}/${d.model || '?'}`;
    case 'model.call':
      return `${d.provider || '?'}/${d.model || '?'}${d.cached ? ' (cached)' : ''}${d.reply_chars ? ` ${d.reply_chars}ch` : ''}`;
    case 'cache.clear':
      return `cache cleared`;
    case 'policy.decision': {
      // Journal shape: {subject, allowed, rule}
      const ok = (d.allowed !== undefined) ? d.allowed : d.allow;
      return `${ok ? 'ALLOW' : 'DENY'} ${d.subject || d.action || d.rule || '?'}`;
    }
    case 'policy.change':
      return `policy updated`;
    case 'config.change':
      // runtime shape: {path, old, new}
      return `config: ${d.path || '?'} → ${typeof d.new === 'object' ? JSON.stringify(d.new) : d.new}`;
    case 'project.init':
      return `project initialized: ${d.name || d.project || '?'}`;
    case 'preset.apply':
      return `preset applied: ${d.preset || d.name || '?'}`;
    case 'goal.add':
      return `goal: ${d.title || d.goal || '?'}`;
    case 'goal.step.add':
      return `step added: ${d.title || d.step || '?'}`;
    case 'goal.step':
      // Journal shape: {goal, step, ok, note}
      return `step ${d.title || d.step || '?'} - ${d.ok === false ? 'failed' : 'ok'}`;
    case 'goal.run':
      return `goal running: ${d.title || d.goal || '?'}`;
    case 'goal.done':
      return `goal done: ${d.title || d.goal || '?'}`;
    case 'cron.add':
      return `cron added: ${d.name || '?'}`;
    case 'cron.toggle':
      return `cron ${d.enabled ? 'enabled' : 'disabled'}: ${d.name || '?'}`;
    case 'cron.run':
      return `cron ran: ${d.name || '?'}`;
    case 'tick.run':
      return `tick: ${d.crons_run ?? 0} run, ${d.proposals_new ?? 0} new, ${d.auto_applied ?? 0} auto-applied`;
    case 'proposal.new':
      return `proposal: ${d.kind || '?'} on ${d.target || '?'}`;
    case 'proposal.apply':
      return `proposal applied: ${d.id || '?'}`;
    case 'proposal.dismiss':
      return `proposal dismissed: ${d.id || '?'}`;
    case 'optimize.run':
      // Journal shape: {model_calls, cache_hits, simple_to_cloud, proposals_created}
      return `optimize: ${d.proposals_created ?? 0} proposal(s) from ${d.model_calls ?? 0} call(s), ${d.cache_hits ?? 0} cached`;
    case 'knowledge.add':
      return `lesson learned: ${d.lesson || d.title || String(d.content || '').slice(0, 60)}`;
    case 'mcp.rpc':
      return `${d.server || '?'}/${d.tool || d.method || '?'}${d.ok !== undefined ? (d.ok ? ' ok' : ' failed') : ''}`;
    case 'mcp.import':
      return `mcp import: ${d.server || d.name || '?'}`;
    case 'mcp.add':
      return `mcp add ${d.server || '?'}`;
    case 'mcp.remove':
      return `mcp remove ${d.server || '?'}`;
    case 'export.bundle':
      // Journal shape: {dir, events, head, format?}
      return `${d.format ? d.format + ' ' : ''}export → ${d.dir || d.path || d.file || '?'}${typeof d.events === 'number' ? ` (${d.events} events)` : ''}`;
    case 'wrap.start': {
      // Journal shape: {label, cmd, args, cwd, env_sensitive, pid}
      const cmdline = [d.cmd, ...(Array.isArray(d.args) ? d.args : [])].filter(Boolean).join(' ');
      return `wrap ${d.label || '?'}: ${String(cmdline || '?').slice(0, 60)}${d.pid ? ` (pid ${d.pid})` : ''}`;
    }
    case 'wrap.end':
      // Journal shape: {label, exit, duration_ms, stdout_sha256, stderr_sha256, stdout_bytes, stderr_bytes, stdout_excerpt, stderr_excerpt, timed_out}
      return `wrap ${d.label || '?'} - ${d.timed_out ? 'timed out' : `exit ${d.exit ?? '?'}`}${typeof d.duration_ms === 'number' ? ` (${d.duration_ms}ms)` : ''}`;
    case 'journal.anchor': {
      // Journal shape: {seq, head, url, tsq_file, tsr_file, tsr_sha256, status}
      let host = String(d.url || '?');
      try { host = new URL(d.url).host; } catch (_) { /* keep raw url */ }
      return `anchor ${d.status || '?'} @ ${host}${d.seq !== undefined ? ` (seq ${d.seq})` : ''}`;
    }
    default:
      return k;
  }
}

/**
 * Truncate a hash string for display: show first 8 + "…" + last 4 chars.
 * @param {string} hash
 * @returns {string}
 */
export function truncHash(hash) {
  if (!hash || hash.length <= 16) return hash || '-';
  return hash.slice(0, 8) + '…' + hash.slice(-4);
}

/**
 * Compute Laplace-smoothed reliability: (successes+1)/(runs+2)
 * @param {number} successes
 * @param {number} runs
 * @returns {number} 0..1
 */
export function laplace(successes, runs) {
  return (successes + 1) / (runs + 2);
}

/**
 * Format bytes to a human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
export function fmtBytes(bytes) {
  if (bytes === null || bytes === undefined) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

// ── v5 helpers ───────────────────────────────────────────────────

/**
 * Create a command preview element (mono block showing the exact CLI command).
 * Used before any mutating action so the operator sees what will run.
 *
 * @param {string} text - the full CLI command string
 * @returns {HTMLElement}
 */
export function cmdPreview(text) {
  return el('div', { cls: 'wizard-cmd-preview', text });
}

/**
 * Create a '?' icon button that toggles a positioned help popover.
 * The popover displays a title and one paragraph per line in `lines`.
 * Closes on outside click.
 *
 * @param {string} title - popover heading
 * @param {string[]} lines - paragraph text lines
 * @returns {HTMLElement} wrapper containing the button and popover
 */
export function helpButton(title, lines) {
  const wrap = el('div', { style: 'position:relative;display:inline-flex;' });

  const btn = el('button', { cls: 'btn-icon', 'aria-label': `Help: ${title}`, title: 'Help', text: '?' });

  const pop = el('div', { cls: 'help-pop hidden', role: 'tooltip' });
  pop.appendChild(el('div', { cls: 'help-pop-title', text: title }));
  for (const line of lines) {
    pop.appendChild(el('p', { text: line }));
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    pop.classList.toggle('hidden');
  });

  // Close on outside click. Views remount on every nav switch, so the
  // listener removes itself once the wrapper leaves the document -
  // otherwise each mount would leak one permanent document listener.
  function onDocClick(e) {
    if (!document.body.contains(wrap)) {
      document.removeEventListener('click', onDocClick);
      return;
    }
    if (!wrap.contains(e.target)) {
      pop.classList.add('hidden');
    }
  }
  document.addEventListener('click', onDocClick);

  wrap.appendChild(btn);
  wrap.appendChild(pop);
  return wrap;
}
