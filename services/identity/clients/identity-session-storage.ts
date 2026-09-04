export interface SessionStorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * Browser sessions are scoped to the current tab and are cleared when the tab
 * closes. Identity access and refresh tokens must never be persisted in
 * localStorage because any unrelated long-lived script execution would gain
 * durable access to them across browser restarts.
 */
export function createBrowserSessionStorageAdapter(): SessionStorageAdapter {
  return {
    getItem: async (key) => {
      try {
        return window.sessionStorage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem: async (key, value) => {
      try {
        window.sessionStorage.setItem(key, value);
      } catch {
        // A blocked storage context intentionally degrades to an in-memory
        // session rather than weakening the boundary by falling back to
        // persistent localStorage.
      }
    },
    removeItem: async (key) => {
      try {
        window.sessionStorage.removeItem(key);
      } catch {
        // Session cleanup is best-effort when the browser blocks storage.
      }
    },
  };
}

const memorySessions = new Map<string, string>();

/** Safe process-lifetime fallback for SSR, tests, and pre-configuration. */
export function createMemorySessionStorageAdapter(): SessionStorageAdapter {
  return {
    getItem: async (key) => memorySessions.get(key) ?? null,
    setItem: async (key, value) => {
      memorySessions.set(key, value);
    },
    removeItem: async (key) => {
      memorySessions.delete(key);
    },
  };
}

export function defaultSessionStorageAdapter(): SessionStorageAdapter {
  const isBrowser =
    typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
  return isBrowser
    ? createBrowserSessionStorageAdapter()
    : createMemorySessionStorageAdapter();
}
