import React from 'react';
import ReactDOM from 'react-dom/client';
import 'animal-island-ui/style';
import App from '../App';
import '../styles/app.css';
import { getStoredEnabled, notifyStatus, setStoredEnabled, type ShellRuntimeMessage } from './bridge';

const ROOT_ID = 'gllue-shell-root';
const LAUNCHER_ID = 'gllue-shell-launcher';
let root: ReactDOM.Root | null = null;

declare global {
  interface Window {
    __gllueShellContentLoaded?: boolean;
    __gllueShellSetEnabled?: (enabled: boolean) => Promise<void>;
  }
}

function ensureRootElement() {
  let element = document.getElementById(ROOT_ID);
  if (!element) {
    element = document.createElement('div');
    element.id = ROOT_ID;
    document.body.appendChild(element);
  }
  return element;
}

function removeLauncher() {
  document.getElementById(LAUNCHER_ID)?.remove();
}

// 启动按钮拖动后记住的位置（按站点存本地）。
const LAUNCHER_POS_KEY = 'gllueShellLauncherPos';

function clampToViewport(left: number, top: number, el: HTMLElement) {
  const maxLeft = window.innerWidth - el.offsetWidth - 4;
  const maxTop = window.innerHeight - el.offsetHeight - 4;
  return {
    left: Math.min(Math.max(4, left), Math.max(4, maxLeft)),
    top: Math.min(Math.max(4, top), Math.max(4, maxTop)),
  };
}

function showLauncher() {
  if (root || document.getElementById(LAUNCHER_ID)) return;
  const button = document.createElement('button');
  button.id = LAUNCHER_ID;
  button.type = 'button';
  button.textContent = '开启更好的谷露前端';
  button.setAttribute('aria-label', '开启更好的谷露前端');
  Object.assign(button.style, {
    position: 'fixed',
    right: '18px',
    bottom: '22px',
    zIndex: '2147483647',
    border: '2px solid #79cab3',
    borderRadius: '999px',
    background: '#fff6dc',
    color: '#6b4b2f',
    boxShadow: '0 8px 0 rgba(107, 75, 47, 0.18), 0 14px 24px rgba(80, 58, 36, 0.16)',
    cursor: 'pointer',
    font: '700 15px/1.2 system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif',
    padding: '12px 18px',
    touchAction: 'none',
  });

  // 可拖动：按住拖走，位置存本地；拖动超过 4px 不算点击。
  let moved = false;
  let startX = 0;
  let startY = 0;
  let originLeft = 0;
  let originTop = 0;
  button.addEventListener('pointerdown', (event) => {
    moved = false;
    startX = event.clientX;
    startY = event.clientY;
    const rect = button.getBoundingClientRect();
    originLeft = rect.left;
    originTop = rect.top;
    button.setPointerCapture(event.pointerId);
  });
  button.addEventListener('pointermove', (event) => {
    if (!button.hasPointerCapture(event.pointerId)) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    moved = true;
    const pos = clampToViewport(originLeft + dx, originTop + dy, button);
    button.style.left = `${pos.left}px`;
    button.style.top = `${pos.top}px`;
    button.style.right = 'auto';
    button.style.bottom = 'auto';
  });
  button.addEventListener('pointerup', (event) => {
    if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
    if (moved) {
      const rect = button.getBoundingClientRect();
      try {
        localStorage.setItem(LAUNCHER_POS_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
      } catch { /* 存不了就算了，不影响使用 */ }
    }
  });

  button.addEventListener('click', () => {
    if (moved) return; // 刚拖完，不当点击
    const url = new URL(window.location.href);
    url.searchParams.delete('gllue_shell');
    if (url.toString() !== window.location.href) {
      window.history.replaceState(window.history.state, document.title, url.toString());
    }
    void setShellEnabled(true);
  });
  document.body.appendChild(button);

  // 恢复上次拖动的位置（没存过就保持默认右下角）。
  try {
    const saved = JSON.parse(localStorage.getItem(LAUNCHER_POS_KEY) || 'null') as { left?: number; top?: number } | null;
    if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
      const pos = clampToViewport(saved.left, saved.top, button);
      button.style.left = `${pos.left}px`;
      button.style.top = `${pos.top}px`;
      button.style.right = 'auto';
      button.style.bottom = 'auto';
    }
  } catch { /* 存的格式坏了就用默认位置 */ }
}

async function shouldBypassShell() {
  if (new URLSearchParams(window.location.search).get('gllue_shell') === 'off') return true;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GLLUE_SHELL_SHOULD_BYPASS' } satisfies ShellRuntimeMessage) as { bypass?: boolean };
    return Boolean(response?.bypass);
  } catch {
    return false;
  }
}

function mountShell() {
  if (root) return;
  removeLauncher();
  document.documentElement.classList.add('gllue-shell-extension');
  document.body.classList.add('gllue-shell-active');
  root = ReactDOM.createRoot(ensureRootElement());
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
  notifyStatus(true);
}

function unmountShell() {
  if (root) {
    root.unmount();
    root = null;
  }
  document.body.classList.remove('gllue-shell-active');
  document.documentElement.classList.remove('gllue-shell-extension');
  document.getElementById(ROOT_ID)?.remove();
  showLauncher();
  notifyStatus(false);
}

async function setShellEnabled(enabled: boolean) {
  await setStoredEnabled(enabled);
  if (enabled) mountShell();
  else unmountShell();
}

function bootstrapShellContent() {
  if (window.__gllueShellContentLoaded) return;
  window.__gllueShellContentLoaded = true;

  window.addEventListener('gllue-shell:disable', () => {
    void setShellEnabled(false);
  });
  document.addEventListener('gllue-shell:disable', () => {
    void setShellEnabled(false);
  });
  window.__gllueShellSetEnabled = setShellEnabled;

  chrome.runtime.onMessage.addListener((rawMessage, _sender, sendResponse) => {
    const message = rawMessage as ShellRuntimeMessage;
    if (message.type === 'GLLUE_SHELL_TOGGLE') {
      void setShellEnabled(!root).then(() => sendResponse({ enabled: Boolean(root) }));
      return true;
    }
    if (message.type === 'GLLUE_SHELL_SET_ENABLED') {
      void setShellEnabled(message.enabled).then(() => sendResponse({ enabled: Boolean(root) }));
      return true;
    }
    return false;
  });

  void getStoredEnabled().then(async (enabled) => {
    if (await shouldBypassShell()) {
      notifyStatus(false);
      showLauncher();
      return;
    }
    if (enabled) mountShell();
    else {
      showLauncher();
      notifyStatus(false);
    }
  });
}

bootstrapShellContent();
