import eslintConfigPrettier from 'eslint-config-prettier';
import perfectionist from 'eslint-plugin-perfectionist';

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: ['dist/**', '.turbo/**', 'node_modules/**', 'coverage/**', '*.config.js']
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: process.cwd()
      }
    },
    plugins: {
      perfectionist: perfectionist['flat/configs/recommended-natural']
    },
    rules: {
      'perfectionist/sort-objects': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off'
    }
  },
  eslintConfigPrettier
];
