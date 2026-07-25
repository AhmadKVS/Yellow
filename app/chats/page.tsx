'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { initialsFor } from '@/lib/initials';
import { useAppState } from '@/lib/store';
import type { PairSummary } from '@/lib/pair';

const MONO =
  'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace';

const FALLBACK_GRADIENT: [string, string] = ['#FFD860', '#B8860B'];

interface Row {
  personId: string;
  name: string;
  firstName: string;
  photoUrl?: string;
  gradient: [string, string];
  /** A sent-but-unanswered intro goes to the exchange, not to a locked thread. */
  waiting: boolean;
  preview: string;
  at: number | null;
  fromMe: boolean;
  unread: number;
}

/**
 * A profile photo, as a CSS layer rather than an `<img>` — the avatar is a
 * decorative disc, and this keeps it one element. Anything that could close
 * the `url("…")` is rejected instead of escaped.
 */
function photoLayer(url: string | undefined): string | null {
  const clean = url?.trim();
  if (!clean || !/^https?:\/\/[^"')\s]+$/i.test(clean)) return null;
  return `url("${clean}") center/cover no-repeat`;
}

function timeLabel(at: number): string {
  const diff = Date.now() - at;
  if (diff < 60_000) return 'now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

/* ------------------------------------------------------------------ */
/* Scoped stylesheet — React hoists + dedupes by href                   */
/* ------------------------------------------------------------------ */
function ChatsStyles() {
  return (
    <style href="yellow-chats" precedence="high">{`
.y-cl-title{ margin:0; font-size:30px; font-weight:700; letter-spacing:-.03em; color:#FFF8E7 }
.y-cl-sub{ margin:5px 0 0; font-size:13.5px; line-height:1.45; color:rgba(255,248,231,.62) }

/* iOS inset-grouped list */
.y-cl-card{
  margin-top:22px; border-radius:18px; overflow:hidden;
  background:rgba(255,255,255,.045);
  border:1px solid rgba(255,255,255,.08);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05), 0 10px 30px -12px rgba(0,0,0,.6);
  list-style:none; padding:0;
}
@keyframes y-cl-in{ from{ opacity:0; transform:translateY(9px) } }
.y-cl-li{ animation:y-cl-in 380ms cubic-bezier(.32,.72,0,1) backwards }
.y-cl-row{
  position:relative; display:flex; align-items:center; gap:12px;
  min-height:68px; padding:11px 14px; text-decoration:none;
  transition:background 180ms linear;
}
.y-cl-row:hover{ background:rgba(255,255,255,.032) }
.y-cl-row:active{ background:rgba(255,255,255,.06) }
.y-cl-row:focus-visible{ outline:2px solid #FFD60A; outline-offset:-2px }
/* Hairline starts after the avatar, the way an iOS list does. */
.y-cl-li + .y-cl-li .y-cl-row::before{
  content:''; position:absolute; left:70px; right:0; top:0; height:1px;
  background:rgba(255,255,255,.08);
}

.y-cl-face{
  position:relative; flex:0 0 auto; width:44px; height:44px; border-radius:9999px;
  display:flex; align-items:center; justify-content:center; overflow:hidden;
  line-height:1;
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.12),
             inset 0 1px 0 rgba(255,255,255,.34),
             0 4px 12px -7px rgba(0,0,0,.85);
}
.y-cl-mono{
  font-weight:600; letter-spacing:.02em; color:#FFF8E7;
  text-shadow:0 1px 3px rgba(0,0,0,.4);
}
.y-cl-wait .y-cl-face{ opacity:.46 }

.y-cl-body{ display:flex; min-width:0; flex:1 1 auto; flex-direction:column; gap:2px }
.y-cl-name{
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  font-size:16.5px; font-weight:600; letter-spacing:-.014em; color:#FFF8E7;
}
.y-cl-wait .y-cl-name{ font-weight:400; color:rgba(255,248,231,.62) }
.y-cl-prev{
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  font-size:13.5px; line-height:1.35; color:rgba(255,248,231,.5);
}
.y-cl-prev-unread{ color:rgba(255,248,231,.82) }
.y-cl-wait .y-cl-prev{ color:rgba(255,248,231,.4) }
.y-cl-mine{ color:rgba(255,248,231,.32) }

.y-cl-rail{
  flex:0 0 auto; display:flex; flex-direction:column; align-items:flex-end;
  justify-content:center; gap:7px; min-width:34px;
}
.y-cl-time{
  font-size:11px; letter-spacing:.02em; font-variant-numeric:tabular-nums;
  color:rgba(255,248,231,.4);
}
.y-cl-time-unread{ color:rgba(255,214,10,.85) }
.y-cl-badge{
  display:flex; align-items:center; justify-content:center;
  height:20px; min-width:20px; padding:0 6px; border-radius:9999px;
  font-size:11px; font-weight:600; line-height:1; letter-spacing:0; color:#1A1200;
  background:linear-gradient(180deg,#FFE45C 0%,#FFC300 100%);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.45);
}
.y-cl-chev{ color:rgba(255,248,231,.25) }

/* Empty state — same grammar, one filled pill. */
.y-cl-empty{
  margin-top:26px; padding:34px 26px 30px; text-align:center;
  border-radius:22px;
  background:rgba(255,255,255,.045);
  border:1px solid rgba(255,255,255,.08);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05), 0 10px 30px -12px rgba(0,0,0,.6);
}
.y-cl-glyph{
  width:46px; height:46px; margin:0 auto; border-radius:9999px;
  display:flex; align-items:center; justify-content:center;
  color:rgba(255,248,231,.55); background:rgba(255,255,255,.05);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.1);
}
.y-cl-empty-h{
  margin:18px 0 0; font-size:16.5px; font-weight:600; letter-spacing:-.014em; color:#FFF8E7;
}
.y-cl-empty-p{
  margin:7px auto 0; max-width:34ch; font-size:13.5px; line-height:1.5;
  color:rgba(255,248,231,.5);
}
.y-cl-cta{
  display:inline-flex; align-items:center; justify-content:center;
  margin-top:24px; height:50px; padding:0 30px; border:0; border-radius:9999px;
  cursor:pointer; text-decoration:none;
  font-size:15px; font-weight:600; letter-spacing:-.01em; color:#1A1200;
  background:linear-gradient(180deg,#FFE45C 0%,#FFC300 100%);
  box-shadow:0 8px 24px -10px rgba(255,199,0,.55), inset 0 1px 0 rgba(255,255,255,.5);
  transition:transform 120ms cubic-bezier(.32,.72,0,1), filter 160ms linear;
}
.y-cl-cta:hover{ filter:brightness(1.04) }
.y-cl-cta:active{ transform:scale(.97) }
.y-cl-cta:focus-visible{ outline:2px solid #FFF8E7; outline-offset:2px }

@media (prefers-reduced-motion: reduce){
  .y-cl-li{ animation-duration:1ms }
  .y-cl-cta, .y-cl-row{ transition-duration:1ms }
}
`}</style>
  );
}

function Chevron() {
  return (
    <svg className="y-cl-chev" width="7" height="12" viewBox="0 0 7 12" aria-hidden>
      <path
        d="M1 1l5 5-5 5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
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
        photoUrl: person?.photoUrl?.trim() || undefined,
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
    <div style={{ minHeight: 'calc(100dvh - 96px)' }} className="pb-12 pt-7">
      <ChatsStyles />

      <h1 className="y-cl-title">Chats</h1>
      <p className="y-cl-sub">Conversations open once you&rsquo;ve both sent an intro.</p>

      {rows.length === 0 ? (
        <div className="y-cl-empty">
          <span className="y-cl-glyph" aria-hidden>
            {people.length === 0 ? (
              <svg width="22" height="22" viewBox="0 0 22 22">
                <circle
                  cx="11"
                  cy="11"
                  r="8.2"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  fill="none"
                  opacity=".5"
                />
                <circle cx="11" cy="11" r="2.7" fill="currentColor" />
                <circle cx="17.4" cy="6.3" r="2.1" fill="currentColor" opacity=".75" />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 22 22">
                <path
                  d="M3.4 10.2c0-3.5 3.4-6.3 7.6-6.3s7.6 2.8 7.6 6.3-3.4 6.3-7.6 6.3c-.9 0-1.8-.1-2.6-.4l-3.9 1.6.9-3A5.7 5.7 0 0 1 3.4 10.2Z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>
            )}
          </span>

          <p className="y-cl-empty-h">
            {people.length === 0 ? 'Nobody else is here yet' : 'No conversations yet'}
          </p>
          <p className="y-cl-empty-p">
            {people.length === 0
              ? 'You’re early. The moment someone else joins, they’ll show up in your orbit and you can trade intros.'
              : 'Find someone you overlap with, trade intros, and the chat opens.'}
          </p>
          <button type="button" className="y-cl-cta" onClick={() => router.push('/home')}>
            {people.length === 0 ? 'Back to your orbit' : 'Find your people'}
          </button>
        </div>
      ) : (
        <ul className="y-cl-card">
          {rows.map((row, i) => {
            const photo = photoLayer(row.photoUrl);
            const mono = initialsFor(row.name);
            return (
            <li
              key={row.personId}
              className="y-cl-li"
              style={{ animationDelay: i < 6 ? `${i * 45}ms` : '0ms' }}
            >
              <Link
                href={row.waiting ? `/connect/${row.personId}` : `/chat/${row.personId}`}
                className={`y-cl-row${row.waiting ? ' y-cl-wait' : ''}`}
              >
                <span
                  aria-hidden="true"
                  className="y-cl-face"
                  style={{
                    background: [
                      photo,
                      `radial-gradient(circle at 32% 26%, ${row.gradient[0]}, ${row.gradient[1]})`,
                    ]
                      .filter(Boolean)
                      .join(', '),
                  }}
                >
                  {photo ? null : (
                    <span
                      className="y-cl-mono"
                      style={{ fontSize: mono.length > 1 ? 14 : 17.5 }}
                    >
                      {mono}
                    </span>
                  )}
                </span>

                <span className="y-cl-body">
                  <span className="y-cl-name">{row.name}</span>
                  {row.waiting ? (
                    <span className="y-cl-prev">Waiting on {row.firstName}</span>
                  ) : (
                    <span
                      className={`y-cl-prev${row.unread > 0 ? ' y-cl-prev-unread' : ''}`}
                    >
                      {row.at !== null && row.fromMe && (
                        <span className="y-cl-mine">You: </span>
                      )}
                      {row.preview}
                    </span>
                  )}
                </span>

                <span className="y-cl-rail">
                  {!row.waiting && row.at !== null ? (
                    <span
                      className={`y-cl-time${row.unread > 0 ? ' y-cl-time-unread' : ''}`}
                      style={{ fontFamily: MONO }}
                    >
                      {timeLabel(row.at)}
                    </span>
                  ) : null}

                  {row.unread > 0 ? (
                    <span className="y-cl-badge" style={{ fontFamily: MONO }}>
                      <span className="sr-only">{row.unread} unread</span>
                      <span aria-hidden="true">{row.unread > 9 ? '9+' : row.unread}</span>
                    </span>
                  ) : (
                    <Chevron />
                  )}
                </span>
              </Link>
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
