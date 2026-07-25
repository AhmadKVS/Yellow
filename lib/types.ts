export interface Profile {
  id: string;
  name: string;
  emoji: string;
  gradient: [string, string];
  tagline: string;
  softSkills: string[];
  interests: string[];
}

export interface SeedPersona extends Profile {
  intro: { who: string; building: string; lookingFor: string };
  cannedReplies: string[];
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
