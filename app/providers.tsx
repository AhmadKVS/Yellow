'use client';

import type { ReactNode } from 'react';
import { AppStateProvider } from '@/lib/store';

export function Providers({ children }: { children: ReactNode }) {
  return <AppStateProvider>{children}</AppStateProvider>;
}
