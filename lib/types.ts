import type { VoiceIntro } from './intro';

export interface Profile {
  id: string;
  name: string;
  emoji: string;
  /** A real photo, picked as an alternate to `emoji`. Falls back to the emoji when absent. */
  photoUrl?: string;
  gradient: [string, string];
  /** The one-liner under the bubble — a truncated excerpt of `bio`, not the whole thing. */
  tagline: string;
  /** The full write-up from onboarding ("who are you, what are you building"). */
  bio?: string;
  softSkills: string[];
  interests: string[];
}

export interface SeedPersona extends Profile {
  intro: { who: string; building: string; lookingFor: string };
  cannedReplies: string[];
  /** Present only when this person actually recorded one. Never synthesised. */
  voiceIntro?: VoiceIntro;
}

export type ConnectionStage = 'stranger' | 'nudged' | 'intro_pending' | 'connected';

export interface Connection {
  personId: string;
  stage: ConnectionStage;
  myIntroSent: boolean;
  theirIntroSent: boolean;
  connectedAt?: number;
}

export interface Message {
  id: string;
  personId: string;
  from: 'me' | 'them';
  kind: 'text' | 'voice';
  text?: string;
  durationSec?: number;
  waveSeed?: number;
  s3Key?: string;
  at: number;
}

export interface Hub {
  id: string;
  name: string;
  emoji: string;
  oneLiner: string;
  memberIds: string[];
}

export interface AppState {
  hydrated: boolean;
  me: Profile | null;
  connections: Record<string, Connection>;
  messages: Message[];
  hubs: Hub[];
  nudgeDismissed: boolean;
}

export interface MatchResult {
  person: SeedPersona;
  score: number;
  sharedSkills: string[];
  sharedInterests: string[];
}
