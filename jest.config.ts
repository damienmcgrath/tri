import nextJest from 'next/jest.js';

const createJestConfig = nextJest({ dir: './' });

const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  testEnvironment: 'jsdom',
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  testPathIgnorePatterns: ['/node_modules/', '/.claude/'],
  collectCoverageFrom: ['lib/**/*.ts', '!lib/supabase/**', '!lib/env/**', '!lib/ui/**'],
  coverageThreshold: {
    global: {
      lines: 75,
      statements: 75,
      functions: 80,
      branches: 50
    }
  }
};

export default createJestConfig(customJestConfig);
