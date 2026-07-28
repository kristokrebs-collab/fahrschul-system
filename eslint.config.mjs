import coreWebVitals from 'eslint-config-next/core-web-vitals'
import typescript from 'eslint-config-next/typescript'

/**
 * eslint-config-next 16 ships native flat configs, so they are imported
 * directly. Routing them through @eslint/eslintrc's FlatCompat bridge instead
 * throws on a circular reference in the plugin graph.
 */
const eslintConfig = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'out/**',
      'playwright-report/**',
      'test-results/**',
      'dashboard.html',
    ],
  },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
]

export default eslintConfig
