import '@testing-library/jest-dom';

process.env.TZ = 'Europe/Dublin';

jest.mock(
  'uuid',
  () => ({
    v4: () => '00000000-0000-4000-8000-000000000000'
  }),
  { virtual: true }
);
