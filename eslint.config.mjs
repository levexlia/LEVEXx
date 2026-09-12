// eslint.config.mjs
import { FlatCompat } from '@eslint/eslintrc';
const compat = new FlatCompat();

export default [
  // base recommended rules
  ...compat.extend('eslint:recommended'),
  ...compat.extend('plugin:@typescript-eslint/recommended'),
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module'
    },
    rules: {
      // project-level adjustments can be added here
      'no-console': 'off'
    }
  },
  {
    ignores: ['node_modules/**', 'dist/**']
  }
];
