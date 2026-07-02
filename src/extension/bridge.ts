export const STORAGE_KEY = 'gllueShellEnabled';

export type ShellRuntimeMessage =
  | { type: 'GLLUE_SHELL_TOGGLE' }
  | { type: 'GLLUE_SHELL_SET_ENABLED'; enabled: boolean }
  | { type: 'GLLUE_SHELL_STATUS'; enabled: boolean }
  | { type: 'GLLUE_SHELL_OPEN_ORIGINAL'; url: string }
  | { type: 'GLLUE_SHELL_SHOULD_BYPASS' }
  | { type: 'MAIMAI_CHECK_PROFILE'; profile: import('../types/gllue').MaimaiProfile }
  | { type: 'MAIMAI_CAPTURE_PROFILE_LINK' };

type StorageShape = {
  [STORAGE_KEY]?: boolean;
};

export function isExtensionRuntime() {
  return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
}

export async function getStoredEnabled() {
  if (!isExtensionRuntime()) return false;
  const values = await chrome.storage.local.get(STORAGE_KEY) as StorageShape;
  return Boolean(values[STORAGE_KEY]);
}

export async function setStoredEnabled(enabled: boolean) {
  if (!isExtensionRuntime()) return;
  await chrome.storage.local.set({ [STORAGE_KEY]: enabled });
}

export function notifyStatus(enabled: boolean) {
  if (!isExtensionRuntime()) return;
  chrome.runtime.sendMessage({ type: 'GLLUE_SHELL_STATUS', enabled } satisfies ShellRuntimeMessage).catch(() => undefined);
}
