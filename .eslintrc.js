module.exports = {
  env: {
    node: true,
    es2022: true,
    jest: true
  },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module'
  },
  extends: ['eslint:recommended'],
  rules: {
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    // IMPORTANT: Use logger from src/utils/logger.js instead of console
    // This ensures structured logging with proper context for debugging
    'no-console': 'error',
    'prefer-const': 'error',
    'no-var': 'error',
    'eqeqeq': ['error', 'always'],
    'curly': ['error', 'all'],
    'semi': ['error', 'always'],
    'quotes': ['error', 'single', { avoidEscape: true }]
  },
  overrides: [
    {
      // Allow console in tests and scripts (not production code)
      files: ['tests/**/*.js', 'scripts/**/*.js'],
      rules: {
        'no-console': 'off'
      }
    },
    {
      // Renderer runs in browser context - no access to Node logger
      // Use console.log/warn/error there (goes to DevTools)
      files: ['electron/ui/**/*.js'],
      rules: {
        'no-console': 'off'
      }
    },
    {
      // The logger itself must use console.error to output
      files: ['src/utils/logger.js'],
      rules: {
        'no-console': 'off'
      }
    },
    {
      // CLI output files use console.log for user-facing output (not logging)
      // These display results to the user, not debug info
      files: ['src/sidecar/read.js', 'src/sidecar/session-utils.js'],
      rules: {
        'no-console': 'off'
      }
    }
  ]
};
