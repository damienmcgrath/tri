import '@testing-library/jest-dom';
import React from 'react';

// React.cache() is only available in React Server Components environments.
// Polyfill as a passthrough for the jsdom test environment.
if (typeof (React as any).cache !== 'function') {
  (React as any).cache = <T extends (...args: any[]) => any>(fn: T): T => fn;
}

// In the jsdom test environment, async server components inside <Suspense>
// cannot be rendered (React 18 client-side doesn't support async components).
// Override Suspense to render only its fallback, skipping async children.
(React as any).Suspense = function TestSuspense({ fallback }: { fallback: React.ReactNode; children: React.ReactNode }) {
  return fallback ?? null;
};

process.env.TZ = 'Europe/Dublin';

jest.mock(
  'uuid',
  () => ({
    v4: () => '00000000-0000-4000-8000-000000000000'
  }),
  { virtual: true }
);
