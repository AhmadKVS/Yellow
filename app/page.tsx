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
    <div className="flex flex-1 flex-col items-center justify-center gap-4">
      <span className="h-3 w-3 animate-pulse rounded-full bg-yellow shadow-glow" />
      <p className="text-sm uppercase tracking-widest text-muted-gold">Yellow</p>
    </div>
  );
}
