/**
 * modal.js - Shared wizard-styled form modal.
 *
 * formModal(opts) builds a centered <dialog class="wizard-dialog"> that looks
 * identical to the onboarding wizard (wizard.js): a header with a title (no
 * step dots), a body the caller fills with .wizard-field rows, an optional
 * live .wizard-cmd-preview command box, and a right-aligned footer with a
 * Cancel button and a primary confirm button.
 *
 * The dialog is appended to document.body and removed on close. Escape, the
 * backdrop, and Cancel all close + clean up. The confirm button shows a busy
 * label while onConfirm runs and re-enables on failure (onConfirm returning
 * false, or throwing - errors surface via showToast).
 *
 * field(labelText, inputEl, hint?) wraps a control in a .wizard-field row and
 * is exported for callers to compose the body.
 *
 * @module views/modal
 */

import { el } from '../render.js';
import { showToast } from './toast.js';

/**
 * Build a labelled .wizard-field row (label + control + optional hint).
 * Matches the wizard's field layout exactly.
 *
 * @param {string} labelText - the field label
 * @param {HTMLElement} inputEl - the control (input/select/textarea/row)
 * @param {string} [hint] - optional dim hint under the control
 * @returns {HTMLDivElement}
 */
export function field(labelText, inputEl, hint) {
  const wrap = el('div', { cls: 'wizard-field' });
  wrap.appendChild(el('label', { text: labelText }));
  wrap.appendChild(inputEl);
  if (hint) wrap.appendChild(el('div', { cls: 'field-hint dim', text: hint }));
  return wrap;
}

/**
 * @typedef {Object} FormModalOpts
 * @property {string} title - dialog title (shown in .wizard-title)
 * @property {HTMLElement|HTMLElement[]} fields - body content (.wizard-field rows)
 * @property {() => string} [commandPreview] - returns the live CLI command string;
 *           when present a .wizard-cmd-preview is rendered and refreshed on any
 *           field input/change.
 * @property {string} [confirmLabel='Save'] - primary button label
 * @property {string} [confirmClass='btn-green'] - extra class on the primary button
 * @property {() => (boolean|void|Promise<boolean|void>)} onConfirm - run on confirm;
 *           return false (or throw) to keep the modal open on error.
 */

/**
 * Open a wizard-styled form modal. Resolves when the modal closes.
 *
 * @param {FormModalOpts} opts
 * @returns {{ dialog: HTMLDialogElement, refreshPreview: () => void, close: () => void }}
 */
export function formModal(opts) {
  const {
    title,
    fields,
    commandPreview,
    confirmLabel = 'Save',
    confirmClass = 'btn-green',
    onConfirm,
  } = opts;

  const dialog = /** @type {HTMLDialogElement} */ (el('dialog', { cls: 'wizard-dialog' }));
  if (title) dialog.setAttribute('aria-label', title);

  const content = el('div', { cls: 'wizard-content' });

  // ── Header (title only - no step dots) ──
  const hdr = el('div', { cls: 'wizard-header' });
  hdr.appendChild(el('div', { cls: 'wizard-title', text: title || '' }));
  content.appendChild(hdr);

  // ── Body ──
  const body = el('div', { cls: 'wizard-body' });
  const fieldEls = Array.isArray(fields) ? fields : [fields];
  for (const f of fieldEls) {
    if (f) body.appendChild(f);
  }

  // ── Optional live command preview ──
  /** @type {HTMLElement|null} */
  let previewEl = null;
  if (typeof commandPreview === 'function') {
    previewEl = el('div', { cls: 'wizard-cmd-preview' });
    body.appendChild(previewEl);
  }
  content.appendChild(body);

  /** Recompute the command preview text. */
  function refreshPreview() {
    if (previewEl && typeof commandPreview === 'function') {
      previewEl.textContent = commandPreview();
    }
  }

  // Refresh preview on any input/change inside the body.
  if (previewEl) {
    body.addEventListener('input', refreshPreview);
    body.addEventListener('change', refreshPreview);
  }

  // ── Footer ──
  const footer = el('div', { cls: 'wizard-footer' });

  const cancelBtn = el('button', { cls: 'btn', text: 'Cancel' });
  cancelBtn.addEventListener('click', () => close());
  footer.appendChild(cancelBtn);

  const confirmBtn = /** @type {HTMLButtonElement} */ (
    el('button', { cls: `btn ${confirmClass}`, text: confirmLabel })
  );
  confirmBtn.addEventListener('click', async () => {
    if (confirmBtn.disabled) return;
    confirmBtn.disabled = true;
    const origText = confirmBtn.textContent;
    confirmBtn.textContent = '…';
    let ok = false;
    try {
      const ret = await onConfirm();
      ok = ret !== false;
    } catch (e) {
      showToast(String(e), 'error');
      ok = false;
    }
    if (ok) {
      close();
    } else {
      confirmBtn.disabled = false;
      confirmBtn.textContent = origText;
    }
  });
  footer.appendChild(confirmBtn);
  content.appendChild(footer);

  dialog.appendChild(content);
  document.body.appendChild(dialog);

  // Backdrop click closes.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });
  // Escape (dialog 'cancel' event) closes + cleans up.
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  // Whenever the dialog closes (any path), remove it from the DOM.
  dialog.addEventListener('close', () => {
    if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
  });

  /** Close the dialog and remove it from the DOM. */
  function close() {
    if (dialog.open) {
      dialog.close(); // 'close' handler removes the node
    } else if (dialog.parentNode) {
      dialog.parentNode.removeChild(dialog);
    }
  }

  refreshPreview();
  dialog.showModal();

  // Focus the first focusable control for keyboard-first entry.
  const firstControl = /** @type {HTMLElement|null} */ (
    body.querySelector('input, select, textarea')
  );
  if (firstControl && typeof firstControl.focus === 'function') firstControl.focus();

  return { dialog, refreshPreview, close };
}
