/**
 * toast.js - Toast notification helper.
 *
 * showToast(message, type) appends a toast to #toast-region.
 * Auto-dismisses after 6 seconds. Has a close button.
 * message is always rendered verbatim (monospace).
 *
 * @module views/toast
 */

import { el } from '../render.js';

/**
 * Show a toast notification.
 *
 * @param {string} message - verbatim text (soma stdout/stderr or app msg)
 * @param {'success'|'error'|'info'} [type='info']
 * @param {number} [ttl=6000] - auto-dismiss delay in ms
 */
export function showToast(message, type = 'info', ttl = 6000) {
  const region = document.getElementById('toast-region');
  if (!region) return;

  const toast = el('div', { cls: `toast toast-${type}` });

  const body = el('div', { cls: 'toast-body', text: String(message) });
  const closeBtn = el('button', { cls: 'btn-icon toast-close', 'aria-label': 'Dismiss notification', text: '✕' });
  closeBtn.addEventListener('click', () => dismiss());

  toast.appendChild(body);
  toast.appendChild(closeBtn);
  region.appendChild(toast);

  let timer = setTimeout(() => dismiss(), ttl);

  function dismiss() {
    clearTimeout(timer);
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.2s';
    setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 200);
  }
}
