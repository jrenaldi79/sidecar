module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '\\.integration\\.test\\.js$',
    '\\.worktrees/'
  ],
  collectCoverageFrom: [
    'src/**/*.js',
    'bin/**/*.js',
    'electron/**/*.js',
    '!**/node_modules/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  verbose: true
};
