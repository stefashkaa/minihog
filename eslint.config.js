import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import vue from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.nuxt/**',
      '**/.output/**',
      '**/coverage/**',
      'output/**',
      'test-results/**',
      'playwright-report/**',
      'pnpm-lock.yaml'
    ]
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts}'],
    languageOptions: { globals: { ...globals.es2022, ...globals.node, ...globals.browser } },
    rules: { 'prefer-const': 'error', 'no-var': 'error', 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] }
  },
  {
    files: ['**/*.{ts,mts,cts}'],
    languageOptions: { parser: tsParser, parserOptions: { ecmaVersion: 'latest', sourceType: 'module' } },
    plugins: { '@typescript-eslint': typescript },
    rules: {
      ...typescript.configs.recommended.rules,
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-empty-object-type': 'off'
    }
  },
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: { parser: tsParser },
      globals: { ...globals.browser, useMiniHog: 'readonly', onMounted: 'readonly' }
    },
    rules: { 'vue/multi-word-component-names': 'off', 'vue/component-name-in-template-casing': ['error', 'PascalCase'] }
  },
  prettier
];
