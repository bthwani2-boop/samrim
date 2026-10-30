import { useEffect, useState } from "react";

type UnreadSnapshot = Readonly<{
  actorScope: string;
  idsKey: string;
  enabled: boolean;
  refreshKey: string;
  counts: Readonly<Record<string, number>>;
}>;

const emptyUnreadCounts: Readonly<Record<string, number>> = {};

/** Bounded conversation unread polling: isolate actors and retain known counts when a refresh fails. */
export function useConversationUnreadCounts(
  conversationIds: ReadonlyArray<string>,
  actorScope: string,
  enabled: boolean,
  getUnread: (conversationId: string) => Promise<number>,
  refreshKey = "",
): Readonly<Record<string, number>> {
  const idsKey = conversationIds.slice(0, 12).join("|");
  const [snapshot, setSnapshot] = useState<UnreadSnapshot>({
    actorScope: "",
    idsKey: "",
    enabled: false,
    refreshKey: "",
    counts: emptyUnreadCounts,
  });

  useEffect(() => {
    let active = true;
    let generation = 0;
    setSnapshot(current =>
      current.actorScope === actorScope && current.idsKey === idsKey &&
      current.enabled === enabled && current.refreshKey === refreshKey
        ? current
        : { actorScope, idsKey, enabled, refreshKey, counts: emptyUnreadCounts },
    );
    if (!enabled || !actorScope || !idsKey) return () => { active = false; };

    const ids = idsKey.split("|");
    const refresh = async () => {
      const run = ++generation;
      const updates: Record<string, number> = {};
      for (let i = 0; i < ids.length; i += 3) {
        const batch = await Promise.all(ids.slice(i, i + 3).map(async id => {
          try {
            const count = await getUnread(id);
            return Number.isSafeInteger(count) && count >= 0 ? { id, count } : null;
          } catch {
            return null;
          }
        }));
        if (!active || run !== generation) return;
        for (const item of batch) if (item) updates[item.id] = item.count;
      }
      if (!active || run !== generation) return;
      setSnapshot(current => {
        if (!active || run !== generation || current.actorScope !== actorScope ||
            current.idsKey !== idsKey || current.enabled !== enabled ||
            current.refreshKey !== refreshKey) return current;
        return { ...current, counts: { ...current.counts, ...updates } };
      });
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 20_000);
    return () => { active = false; clearInterval(interval); };
  }, [idsKey, actorScope, enabled, getUnread, refreshKey]);

  return enabled && actorScope && snapshot.actorScope === actorScope &&
    snapshot.idsKey === idsKey && snapshot.enabled === enabled &&
    snapshot.refreshKey === refreshKey
      ? snapshot.counts
      : emptyUnreadCounts;
}
