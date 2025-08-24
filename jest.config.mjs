// ESM Jest config using ts-jest
// ESM Jest config using ts-jest ESM preset

const tsJestTransform = [
  'ts-jest',
  {
    useESM: true,
    diagnostics: { warnOnly: true },
    tsconfig: '<rootDir>/tsconfig.jest.json'
  }
]

export default {
  // Use the ESM-friendly ts-jest preset
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'jsdom',
  testMatch: ['<rootDir>/tests/**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': tsJestTransform
  },
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  testEnvironmentOptions: {
    url: 'http://localhost/'
  },
  watchman: false
}

