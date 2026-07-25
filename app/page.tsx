'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAppState } from '@/lib/store';

export default function Home() {
  const router = useRouter();
  const { state } = useAppState();
  const { hydrated, me } = state;

  useEffect(() => {
    if (!hydrated) return;
    router.replace(me ? '/home' : '/onboarding');
  }, [hydrated, me, router]);

  return (
    <div className="flex min-h-dvh flex-1 flex-col items-center justify-center gap-5">
      <span
        aria-hidden="true"
        className="h-3 w-3 animate-breathe rounded-full bg-yellow shadow-glow"
      />
      <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-gold">
        Yellow
      </p>
    </div>
  );
}
