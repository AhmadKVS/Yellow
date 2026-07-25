'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAppState } from '@/lib/store';
import type { ConnectionStage, Message, SeedPersona } from '@/lib/types';

interface Thread {
  person: SeedPersona;
  last: Message | null;
  count: number;
  stage: ConnectionStage;
}

function preview(m: Message | null): string {
  if (!m) return 'You both showed up. Say the first thing.';
  if (m.kind === 'voice') return `Voice note · ${m.durationSec ?? 0}s`;
  return m.text?.trim() || '—';
}

function timeLabel(at: number): string {
  const diff = Date.now() - at;
  if (diff < 60_000) return 'now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

export default function ChatsPage() {
  const router = useRouter();
  const { state, people, peopleSource } = useAppState();

  const threads: Thread[] = useMemo(() => {
    const byPerson = new Map<string, Message[]>();
    for (const m of state.messages) {
      const list = byPerson.get(m.personId);
      if (list) list.push(m);
      else byPerson.set(m.personId, [m]);
    }

    const ids = new Set<string>([
      ...Object.keys(state.connections).filter(
        (id) => state.connections[id]?.stage === 'connected',
      ),
      ...byPerson.keys(),
    ]);

    return [...ids]
      .flatMap<Thread>((id) => {
        // Someone no longer in the directory simply drops off the list
        // rather than rendering a broken row.
        const person = people.find((p) => p.id === id);
        if (!person) return [];
        const msgs = (byPerson.get(id) ?? []).slice().sort((a, b) => a.at - b.at);
        return [
          {
            person,
            last: msgs.length > 0 ? msgs[msgs.length - 1] : null,
            count: msgs.length,
            stage: state.connections[id]?.stage ?? 'stranger',
          },
        ];
      })
      .sort((a, b) => (b.last?.at ?? 0) - (a.last?.at ?? 0));
  }, [state.messages, state.connections, people]);

  // Hold until the directory answers too — otherwise every thread resolves to
  // "person not found" for a frame and the list flashes empty.
  if (!state.hydrated || peopleSource === 'loading') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <span
          className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#FFD60A]"
          style={{ boxShadow: '0 0 20px 3px rgba(255,214,10,.55)' }}
        />
        <span className="sr-only">Loading conversations</span>
      </div>
    );
  }

  return (
    <div style={{ minHeight: 'calc(100dvh - 96px)' }} className="pb-10 pt-7">
      <h1 className="text-[24px] font-semibold tracking-tight text-[#FFF8E7]">Chats</h1>
      <p className="mt-1 text-[13px] leading-relaxed text-[#FFF8E7]/40">
        Conversations open once you&rsquo;ve both sent an intro.
      </p>

      {threads.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-[#FFD60A]/12 bg-[#FFF8E7]/[0.02] px-6 py-10 text-center">
          <div
            aria-hidden="true"
            className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full text-[19px]"
            style={{
              background: 'linear-gradient(180deg,#FFE45C 0%,#FFC300 100%)',
              boxShadow: '0 0 26px 3px rgba(255,214,10,.3)',
            }}
          >
            {people.length === 0 ? '🌱' : '💬'}
          </div>
          <p className="text-[15px] font-medium text-[#FFF8E7]">
            {people.length === 0 ? 'Nobody else is here yet' : 'No conversations yet'}
          </p>
          <p className="mx-auto mt-1.5 max-w-[34ch] text-[13px] leading-relaxed text-[#FFF8E7]/40">
            {people.length === 0
              ? 'You’re early. The moment someone else joins, they’ll show up in your orbit and you can trade intros.'
              : 'Find someone you overlap with, trade intros, and the chat opens.'}
          </p>
          <button
            type="button"
            onClick={() => router.push('/home')}
            className="mt-6 h-11 rounded-xl px-6 text-[14px] font-semibold text-[#1B1400] transition-transform duration-200 hover:scale-[1.02]"
            style={{
              background: 'linear-gradient(180deg,#FFE45C 0%,#FFC300 100%)',
              boxShadow: '0 6px 26px -6px rgba(255,214,10,.5)',
            }}
          >
            {people.length === 0 ? 'Back to your orbit' : 'Find your people'}
          </button>
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {threads.map((t) => (
            <li key={t.person.id}>
              <Link
                href={`/chat/${t.person.id}`}
                className="flex items-center gap-3.5 rounded-2xl border border-transparent px-3 py-3 transition-colors duration-200 hover:border-[#FFD60A]/15 hover:bg-[#FFF8E7]/[0.03]"
              >
                <span
                  aria-hidden="true"
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[21px]"
                  style={{
                    background: `radial-gradient(circle at 32% 28%, ${t.person.gradient[0]}, ${t.person.gradient[1]})`,
                    boxShadow: '0 0 18px -2px rgba(255,214,10,.28)',
                  }}
                >
                  {t.person.emoji}
                </span>

                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[15px] font-medium text-[#FFF8E7]">
                      {t.person.name}
                    </span>
                    {t.last && (
                      <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-[#FFF8E7]/28">
                        {timeLabel(t.last.at)}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 truncate text-[13px] text-[#FFF8E7]/42">
                    {t.last?.from === 'me' && (
                      <span className="text-[#FFF8E7]/28">You: </span>
                    )}
                    {preview(t.last)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
