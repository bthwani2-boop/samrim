import type { CustomerFundingHistory, CustomerWalletBalance } from "@bthwani/wlt";

type Denied = { kind: "signed-out" | "unavailable" };
type Balance = { kind: "ready"; balance: CustomerWalletBalance; expiresAt: number } | Denied;
type History = { kind: "ready"; history: CustomerFundingHistory; expiresAt: number } | Denied;
export type WalletView = {
  balance: Balance | null;
  history: History | null;
  loadingMore: boolean;
  moreError: boolean;
};

type Readers = {
  active: () => boolean;
  readBalance: (signal: AbortSignal, actor?: string) => Promise<Balance>;
  readHistory: (signal: AbortSignal, cursor?: string, actor?: string) => Promise<History>;
};
type Timer = ReturnType<typeof setTimeout>;
type Work = { controller: AbortController; timer?: Timer };

export const emptyWalletView: WalletView = {
  balance: null, history: null, loadingMore: false, moreError: false,
};
const readBudget = 12_000;
const pollInterval = 30_000;

// One request-local display owner for both platforms. Only the owner readers
// supply financial values. A deadline releases the display lease even when a
// transport ignores cancellation; a detached result cannot publish anything.
export function createWalletLifecycle(readers: Readers, publish: (view: WalletView) => void) {
  let view = emptyWalletView;
  let stopped = false;
  let refreshWork: Work | undefined;
  let moreWork: Work | undefined;
  let expiry: Timer | undefined;
  let expiryGeneration = 0;

  function update(next: WalletView) {
    view = next;
    publish(next);
  }
  function release(work: Work | undefined) {
    if (work) clearTimeout(work.timer);
  }
  function cancel(work: Work | undefined) {
    release(work);
    work?.controller.abort();
  }
  function clearExpiry() {
    expiryGeneration++;
    clearTimeout(expiry);
    expiry = undefined;
  }
  function hide(kind?: Denied["kind"]) {
    const previousRefresh = refreshWork;
    const previousMore = moreWork;
    refreshWork = moreWork = undefined;
    clearExpiry();
    cancel(previousRefresh);
    cancel(previousMore);
    update(kind ? { ...emptyWalletView, balance: { kind } } : emptyWalletView);
  }
  function scheduleExpiry(at: number) {
    clearExpiry();
    const generation = expiryGeneration;
    expiry = setTimeout(() => {
      if (!stopped && generation === expiryGeneration) hide("signed-out");
    }, Math.min(2_147_483_647, Math.max(0, at - Date.now())));
  }
  function isCurrent(work: Work, activeWork: Work | undefined) {
    return !stopped && work === activeWork && !work.controller.signal.aborted && readers.active();
  }
  function verifiedUntil() {
    if (view.balance?.kind !== "ready") return 0;
    return Math.min(view.balance.expiresAt,
      view.history?.kind === "ready" ? view.history.expiresAt : view.balance.expiresAt);
  }
  function validExpiry(at: number) {
    return Number.isFinite(at) && at > Date.now();
  }

  function refresh(silent = false) {
    if (stopped) return;
    if (!readers.active()) { hide(); return; }
    if (silent && (refreshWork || moreWork)) return;
    if (!silent) hide();
    if (view.balance?.kind === "ready" && !validExpiry(verifiedUntil())) {
      hide("signed-out");
      return;
    }
    const previousActor = view.balance?.kind === "ready" ? view.balance.balance.actorId : undefined;
    const work: Work = { controller: new AbortController() };
    refreshWork = work;
    const current = () => isCurrent(work, refreshWork);
    work.timer = setTimeout(() => {
      if (current()) hide("unavailable");
    }, readBudget);
    void (async () => {
      try {
        const balance = await readers.readBalance(work.controller.signal, previousActor);
        if (!current()) return;
        if (balance.kind !== "ready") { hide(balance.kind); return; }
        if ((previousActor !== undefined && previousActor !== balance.balance.actorId) ||
            !validExpiry(balance.expiresAt) ||
            (previousActor !== undefined && !validExpiry(verifiedUntil()))) {
          hide("signed-out");
          return;
        }
        if (!previousActor) {
          update({ ...emptyWalletView, balance });
          scheduleExpiry(balance.expiresAt);
        }
        const history = await readers.readHistory(work.controller.signal, undefined, balance.balance.actorId);
        if (!current()) return;
        if (history.kind !== "ready") { hide(history.kind); return; }
        const until = Math.min(balance.expiresAt, history.expiresAt);
        if (history.history.actorId !== balance.balance.actorId || !validExpiry(until) ||
            !validExpiry(verifiedUntil())) {
          hide("signed-out");
          return;
        }
        update({ balance, history, loadingMore: false, moreError: false });
        scheduleExpiry(until);
      } catch {
        if (current()) hide("unavailable");
      } finally {
        if (refreshWork === work) {
          refreshWork = undefined;
          release(work);
        }
      }
    })();
  }

  function loadMore() {
    if (stopped || !readers.active() || refreshWork || moreWork ||
        view.balance?.kind !== "ready" || view.history?.kind !== "ready") return;
    const { balance, history } = view;
    const cursor = history.history.nextCursor;
    if (!cursor) return;
    const actor = balance.balance.actorId;
    if (history.history.actorId !== actor || !validExpiry(verifiedUntil())) {
      hide("signed-out");
      return;
    }
    const work: Work = { controller: new AbortController() };
    moreWork = work;
    const current = () => isCurrent(work, moreWork);
    function failed() {
      if (!current()) return;
      moreWork = undefined;
      cancel(work);
      update({ ...view, loadingMore: false, moreError: true });
    }
    update({ ...view, loadingMore: true, moreError: false });
    work.timer = setTimeout(failed, readBudget);
    void (async () => {
      try {
        const next = await readers.readHistory(work.controller.signal, cursor, actor);
        if (!current()) return;
        if (next.kind === "signed-out") { hide("signed-out"); return; }
        if (next.kind !== "ready") { failed(); return; }
        const until = Math.min(balance.expiresAt, history.expiresAt, next.expiresAt);
        if (next.history.actorId !== actor || !validExpiry(until)) {
          hide("signed-out");
          return;
        }
        const ids = new Set(history.history.items.map(item => item.fundingId));
        if (next.history.nextCursor === cursor || next.history.items.some(item => ids.has(item.fundingId))) {
          failed();
          return;
        }
        update({
          balance,
          history: {
            kind: "ready",
            history: { ...next.history, items: [...history.history.items, ...next.history.items] },
            expiresAt: Math.min(history.expiresAt, next.expiresAt),
          },
          loadingMore: false, moreError: false,
        });
        scheduleExpiry(until);
      } catch {
        failed();
      } finally {
        if (moreWork === work) {
          moreWork = undefined;
          release(work);
        }
      }
    })();
  }

  const interval = setInterval(() => refresh(true), pollInterval);
  return {
    refresh, loadMore,
    hide: () => hide(),
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(interval);
      hide();
    },
  };
}
