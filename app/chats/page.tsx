'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAppState } from '@/lib/store';
import type { PairSummary } from '@/lib/pair';

const FALLBACK_GRADIENT: [string, string] = ['#FFD860', '#B8860B'];

interface Row {
  personId: string;
  name: string;
  firstName: string;
  emoji: string;
  gradient: [string, string];
  /** A sent-but-unanswered intro goes to the exchange, not to a locked thread. */
  waiting: boolean;
  preview: string;
  at: number | null;
  fromMe: boolean;
  unread: number;
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
  const { state, people, peopleSource, pairs, pairsLoaded, unreadFor } = useAppState();

  const rows: Row[] = useMemo(() => {
    const visible = (p: PairSummary) => Boolean(p.connectedAt) || p.myIntroSent;

    return pairs.filter(visible).map((pair) => {
      // Someone the directory hasn't handed us yet still gets a row: the pair
      // is real, and hiding it would read as a lost conversation.
      const person = people.find((p) => p.id === pair.personId);
      const name = person?.name ?? 'Someone';
      const waiting = !pair.connectedAt;

      return {
        personId: pair.personId,
        name,
        firstName: name.trim().split(/\s+/)[0] || name,
        emoji: person?.emoji ?? '\u{1F44B}',
        gradient: person?.gradient ?? FALLBACK_GRADIENT,
        waiting,
        preview: pair.lastMessagePreview ?? 'Say the first thing.',
        at: pair.lastMessageAt,
        fromMe: pair.lastSenderIsMe,
        unread: waiting ? 0 : unreadFor(pair.personId),
      };
    });
  }, [pairs, people, unreadFor]);

  // Hold until the shared pairs *and* the directory have answered — otherwise
  // the list claims you have no conversations for a frame, which is a lie.
  if (!state.hydrated || !pairsLoaded || peopleSource === 'loading') {
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

      {rows.length === 0 ? (
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
          {rows.map((row) => (
            <li key={row.personId}>
              <Link
                href={row.waiting ? `/connect/${row.personId}` : `/chat/${row.personId}`}
                className="flex items-center gap-3.5 rounded-2xl border border-transparent px-3 py-3 transition-colors duration-200 hover:border-[#FFD60A]/15 hover:bg-[#FFF8E7]/[0.03]"
              >
                <span
                  aria-hidden="true"
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[21px] ${
                    row.waiting ? 'opacity-55' : ''
                  }`}
                  style={{
                    background: `radial-gradient(circle at 32% 28%, ${row.gradient[0]}, ${row.gradient[1]})`,
                    boxShadow: row.waiting
                      ? 'none'
                      : '0 0 18px -2px rgba(255,214,10,.28)',
                  }}
                >
                  {row.emoji}
                </span>

                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-baseline justify-between gap-3">
                    <span
                      className={`truncate text-[15px] ${
                        row.waiting
                          ? 'font-normal text-[#FFF8E7]/62'
                          : row.unread > 0
                            ? 'font-semibold text-[#FFF8E7]'
                            : 'font-medium text-[#FFF8E7]'
                      }`}
                    >
                      {row.name}
                    </span>
                    {!row.waiting && row.at !== null && (
                      <span
                        className={`shrink-0 font-mono text-[10px] uppercase tracking-wider ${
                          row.unread > 0 ? 'text-[#FFD60A]/80' : 'text-[#FFF8E7]/28'
                        }`}
                      >
                        {timeLabel(row.at)}
                      </span>
                    )}
                  </span>

                  <span className="mt-0.5 flex items-center justify-between gap-3">
                    {row.waiting ? (
                      <span className="truncate text-[13px] text-[#FFF8E7]/32">
                        Waiting on {row.firstName}
                      </span>
                    ) : (
                      <span
                        className={`truncate text-[13px] ${
                          row.unread > 0
                            ? 'font-medium text-[#FFF8E7]/78'
                            : 'text-[#FFF8E7]/42'
                        }`}
                      >
                        {row.at !== null && row.fromMe && (
                          <span className="text-[#FFF8E7]/28">You: </span>
                        )}
                        {row.preview}
                      </span>
                    )}

                    {row.unread > 0 && (
                      <span
                        className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-[5px] font-mono text-[10px] font-semibold leading-none text-[#1A1200]"
                        style={{
                          background: 'linear-gradient(180deg,#FFE45C 0%,#FFC300 100%)',
                          boxShadow:
                            '0 0 12px rgba(255,214,10,.45), inset 0 1px 0 rgba(255,255,255,.5)',
                        }}
                      >
                        <span className="sr-only">{row.unread} unread</span>
                        <span aria-hidden="true">
                          {row.unread > 9 ? '9+' : row.unread}
                        </span>
                      </span>
                    )}
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
