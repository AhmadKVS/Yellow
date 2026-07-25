'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const STORAGE_KEY = 'yellow:v1';
const CLOUD_TIMEOUT_MS = 3_000;

/**
 * Clearing localStorage alone isn't enough — the store hydrates from
 * DynamoDB too, so a stale cloud row would resurrect the old profile on the
 * next load. We overwrite it with an empty state stamped `savedAt: Date.now()`
 * so it beats anything already stored.
 */
function emptyState() {
  return {
    hydrated: false,
    me: null,
    connections: {},
    messages: [],
    hubs: [],
    nudgeDismissed: false,
    savedAt: Date.now(),
  };
}

export default function ResetPage() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Private mode / quota — nothing we can do, keep going.
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CLOUD_TIMEOUT_MS);
      try {
        await fetch('/api/state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: 'me', state: emptyState() }),
          signal: controller.signal,
        });
      } catch {
        // Offline / slow / 500 — the local wipe already happened, so continue.
      } finally {
        clearTimeout(timer);
      }

      if (!cancelled) router.replace('/onboarding');
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-sm text-muted-gold">Resetting…</p>
    </div>
  );
}
