declare namespace chrome {
  namespace runtime {
    const id: string | undefined;
    const onInstalled: {
      addListener(callback: () => void): void;
    };
    const onStartup: {
      addListener(callback: () => void): void;
    };
    const onMessage: {
      addListener(
        callback: (message: unknown, sender: { tab?: tabs.Tab }, sendResponse: (response?: unknown) => void) => boolean | void,
      ): void;
    };
    function sendMessage(message: unknown): Promise<unknown>;
    function getManifest(): { version: string; name: string };
  }

  namespace alarms {
    interface Alarm {
      name: string;
    }
    function create(name: string, alarmInfo: { when?: number; delayInMinutes?: number; periodInMinutes?: number }): void;
    const onAlarm: {
      addListener(callback: (alarm: Alarm) => void): void;
    };
  }

  namespace storage {
    const local: {
      get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  }

  namespace action {
    const onClicked: {
      addListener(callback: (tab: tabs.Tab) => void): void;
    };
    function setBadgeText(details: { tabId?: number; text: string }): Promise<void>;
    function setBadgeBackgroundColor(details: { tabId?: number; color: string }): Promise<void>;
    function setTitle(details: { tabId?: number; title: string }): Promise<void>;
  }

  namespace tabs {
    interface Tab {
      id?: number;
      url?: string;
    }
    const onUpdated: {
      addListener(callback: (tabId: number, changeInfo: { status?: string }, tab: Tab) => void): void;
    };
    const onRemoved: {
      addListener(callback: (tabId: number) => void): void;
    };
    function create(details: { url: string; active?: boolean }, callback?: (tab: Tab) => void): void;
    function query(queryInfo: { url?: string | string[]; active?: boolean; currentWindow?: boolean }): Promise<Tab[]>;
    function update(tabId: number, details: { url?: string; active?: boolean }, callback?: (tab: Tab) => void): void;
    function reload(tabId: number): void;
    function sendMessage(tabId: number, message: unknown): Promise<unknown>;
  }

  namespace scripting {
    interface InjectionResult<T = unknown> {
      frameId: number;
      result?: T;
    }
    function insertCSS(details: { target: { tabId: number }; files: string[] }): Promise<void>;
    function executeScript(details: { target: { tabId: number }; files: string[] }): Promise<InjectionResult[]>;
    function executeScript<T>(details: { target: { tabId: number }; func: () => T }): Promise<Array<InjectionResult<T>>>;
  }
}
