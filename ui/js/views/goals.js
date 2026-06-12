/**
 * goals.js - Goals board (v2, UI-SPEC §8a).
 *
 * Cards from `goal list --json`: title, why (dim), acceptance list, step list
 * (name + kind chip + last-run status dot from timeline buffer).
 * A "Run goal" button streams `goal run <id>` into the shared console.
 *
 * @module views/goals
 */

import { el, fmtTime, helpButton, cmdPreview } from '../render.js';
import { get, setState } from '../state.js';
import { goalList } from '../soma.js';
import { showToast } from './toast.js';
import { isRunning, startRun } from './console.js';

let _mounted = false;

/**
 * Mount the Goals board into #view-container.
 */
export async function mountGoals() {
  _mounted = true;
  renderShell();
  await loadGoals();
}

/**
 * Unmount.
 */
export function unmountGoals() {
  _mounted = false;
}

async function loadGoals() {
  const project = get('currentProject');
  if (!project) return;
  try {
    const goals = await goalList(project);
    setState({ goals: goals || [] });
    if (_mounted) renderCards();
  } catch (e) {
    showToast(`goal list: ${e}`, 'error');
    if (_mounted) renderCards();
  }
}

function renderShell() {
  const container = document.getElementById('view-container');
  if (!container) return;
  container.innerHTML = '';

  const header = el('div', { cls: 'section-header' });
  header.appendChild(el('h2', { cls: 'section-title', text: 'Goals' }));
  header.appendChild(helpButton('Goals', [
    'Goals are multi-step objectives defined in your project. Each goal has a title, a why, acceptance criteria, and an ordered list of steps - each step is a skill invocation.',
    'The status dot on each step reflects the last run outcome from the Timeline buffer: green = ok, red = failed, grey = never run.',
    'Add goals with soma goal add "<title>" from your terminal. Run a goal with the Run goal button - output streams to the shared console and every step result lands in the Timeline.',
  ]));
  const refreshBtn = el('button', { cls: 'btn', text: '↻ Refresh' });
  refreshBtn.addEventListener('click', () => loadGoals());
  header.appendChild(refreshBtn);
  container.appendChild(header);

  container.appendChild(el('div', { id: 'goals-grid', cls: 'goals-grid' }));
}

function renderCards() {
  const grid = document.getElementById('goals-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const goals = get('goals') || [];
  if (goals.length === 0) {
    const empty = el('div', { cls: 'empty-state' });
    empty.appendChild(el('div', { text: 'No goals yet - add one from your terminal:' }));
    empty.appendChild(cmdPreview('soma goal add "<title>"'));
    grid.appendChild(empty);
    return;
  }

  for (const goal of goals) {
    grid.appendChild(renderGoalCard(goal));
  }
}

/**
 * Build a goal card element.
 * @param {object} goal - from goal list --json
 * @returns {HTMLElement}
 */
function renderGoalCard(goal) {
  const card = el('div', { cls: 'goal-card' });

  // Title row
  const titleRow = el('div', { cls: 'goal-card-title-row' });
  titleRow.appendChild(el('span', { cls: 'goal-title', text: goal.title || goal.id || '?' }));

  // Status chip
  const status = goal.status || 'open';
  const statusCls = status === 'done' ? 'chip-green' : status === 'failed' ? 'chip-red' : 'chip-gray';
  titleRow.appendChild(el('span', { cls: `chip ${statusCls}`, text: status }));
  card.appendChild(titleRow);

  // Why
  if (goal.why) {
    card.appendChild(el('div', { cls: 'goal-why dim', text: goal.why }));
  }

  // Acceptance criteria
  const acceptance = Array.isArray(goal.acceptance) ? goal.acceptance : [];
  if (acceptance.length > 0) {
    const accSection = el('div', { cls: 'goal-section' });
    accSection.appendChild(el('div', { cls: 'goal-section-label', text: 'Acceptance' }));
    const list = el('ul', { cls: 'goal-acceptance-list' });
    for (const criterion of acceptance) {
      list.appendChild(el('li', { text: String(criterion) }));
    }
    accSection.appendChild(list);
    card.appendChild(accSection);
  }

  // Steps
  const steps = Array.isArray(goal.steps) ? goal.steps : [];
  if (steps.length > 0) {
    const stepsSection = el('div', { cls: 'goal-section' });
    stepsSection.appendChild(el('div', { cls: 'goal-section-label', text: 'Steps' }));
    const stepList = el('div', { cls: 'goal-steps' });
    for (const step of steps) {
      stepList.appendChild(renderStep(step, goal.id || goal.title || ''));
    }
    stepsSection.appendChild(stepList);
    card.appendChild(stepsSection);
  }

  // Run button
  const footer = el('div', { cls: 'goal-card-footer' });
  const runBtn = el('button', { cls: 'btn btn-green', text: '▶ Run goal' });
  const goalId = goal.id;
  runBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handleRunGoal(goalId, runBtn);
  });
  footer.appendChild(runBtn);

  // Last run time - runtime writes last_run_iso (last_run is a step array).
  if (goal.last_run_iso) {
    footer.appendChild(el('span', { cls: 'dim', style: 'font-size:11px', text: fmtTime(goal.last_run_iso) }));
  }
  card.appendChild(footer);

  return card;
}

/**
 * Render a step row with kind chip and last-run status dot.
 * @param {object} step
 * @param {string} goalRef - goal id or title for event matching
 * @returns {HTMLElement}
 */
function renderStep(step, goalRef) {
  const row = el('div', { cls: 'goal-step-row' });

  // Status dot from timeline buffer
  const dot = el('span', { cls: `goal-step-dot ${getStepDotCls(goalRef, step.name || '')}` });
  row.appendChild(dot);

  // Step name
  row.appendChild(el('span', { cls: 'goal-step-name', text: step.name || '?' }));

  // Kind chip
  if (step.kind) {
    row.appendChild(el('span', { cls: 'chip chip-gray', text: step.kind }));
  }

  return row;
}

/**
 * Derive step last-run status from the events buffer.
 * Looks for goal.step events matching goalRef + stepName.
 * @param {string} goalRef
 * @param {string} stepName
 * @returns {string} CSS class suffix for the dot
 */
function getStepDotCls(goalRef, stepName) {
  const events = get('events') || [];
  for (const ev of events) {
    if (ev.kind !== 'goal.step') continue;
    const d = ev.data || ev;
    const evGoal = d.goal || d.id || '';
    const evStep = d.step || d.name || '';
    // BOTH must match - step names can collide across goals.
    if (evGoal !== goalRef || evStep !== stepName) continue;
    return d.ok === false ? 'dot-fail' : 'dot-ok';
  }
  return 'dot-none';
}

async function handleRunGoal(goalId, runBtn) {
  if (!goalId) return;
  if (isRunning()) {
    showToast('a run is already in progress', 'error');
    return;
  }

  const project = get('currentProject');
  runBtn.disabled = true;

  const code = await startRun(`goal run ${goalId}`, ['goal', 'run', goalId], project, {
    onDone: (exitCode) => {
      runBtn.disabled = false;
      triggerPollAndVerify();
    },
  });

  if (code !== -1) {
    runBtn.disabled = false;
  }
}

function triggerPollAndVerify() {
  import('../app.js').then(({ triggerPollAndVerify: tpv }) => {
    if (typeof tpv === 'function') tpv();
  }).catch(() => {});
}
