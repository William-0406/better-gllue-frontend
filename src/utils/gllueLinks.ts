import { GLLUE_BASE } from '../config';

declare global {
  interface Window {
    __gllueShellSetEnabled?: (enabled: boolean) => Promise<void>;
  }
}

function isExtensionShell() {
  return document.documentElement.classList.contains('gllue-shell-extension');
}

function openOriginalTab(url: string) {
  if (isExtensionShell() && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ type: 'GLLUE_SHELL_OPEN_ORIGINAL', url }).catch(() => {
      window.open(url, '_blank', 'noopener,noreferrer');
    });
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

function forceRestoreOriginalPage() {
  document.body.classList.remove('gllue-shell-active');
  document.documentElement.classList.remove('gllue-shell-extension');
  document.getElementById('gllue-shell-root')?.remove();
}

export function openGllueHash(hash: string) {
  const normalized = hash.startsWith('#') ? hash : `#${hash}`;
  openOriginalTab(`${GLLUE_BASE}?gllue_shell=off${normalized}`);
}

export function restoreGllue(hash = '#dashboard') {
  if (isExtensionShell()) {
    const normalized = hash.startsWith('#') ? hash : `#${hash}`;
    window.history.replaceState(null, '', `${window.location.pathname}?gllue_shell=off${normalized}`);
    window.__gllueShellSetEnabled?.(false).catch(() => undefined);
    window.dispatchEvent(new CustomEvent('gllue-shell:disable'));
    document.dispatchEvent(new CustomEvent('gllue-shell:disable'));
    window.setTimeout(forceRestoreOriginalPage, 80);
    return;
  }
  openOriginalTab(`${GLLUE_BASE}${hash}`);
}

export function candidateDetail(id: number) {
  return `#candidate/detail?id=${id}`;
}

export function clientDetail(id: number) {
  return `#client/detail?id=${id}`;
}

export function jobDetail(id: number) {
  return `#joborder/detail?id=${id}`;
}
