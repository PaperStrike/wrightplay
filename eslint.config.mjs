import path from 'node:path'
import { defineConfig } from 'eslint/config'
import { includeIgnoreFile } from '@eslint/compat'
import eslint from '@eslint/js'
import markdown from '@eslint/markdown'
import stylistic from '@stylistic/eslint-plugin'
import tseslint from 'typescript-eslint'
import importPlugin from 'eslint-plugin-import'
import tsParserService from 'eslint-config-ts-parser-service'

export default defineConfig(
  // .gitignore
  includeIgnoreFile(path.resolve(import.meta.dirname, '.gitignore')),
  // JS/TS
  {
    files: ['**/*.?(m|c){js,ts}'],
    extends: [
      eslint.configs.recommended,
      stylistic.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      importPlugin.flatConfigs.recommended,
      importPlugin.flatConfigs.typescript,
      tsParserService.configs.resolver,
      {
        languageOptions: {
          parserOptions: {
            projectService: true,
            tsconfigRootDir: import.meta.dirname,
          },
        },
      },
      // Dependency issues.
      {
        rules: {
          // TypeScript isn't smart enough for this.
          '@typescript-eslint/no-non-null-assertion': 'off',
          // TypeScript handles this smarter.
          'import/namespace': 'off',
        },
      },
      // Stylistic rules.
      {
        rules: {
          '@typescript-eslint/restrict-template-expressions': ['error', {
            allowAny: false,
            allowBoolean: true,
            allowNullish: true,
            allowNumber: true,
            allowRegExp: true,
          }],
          '@typescript-eslint/no-unused-vars': ['error', {
            args: 'all',
            argsIgnorePattern: '^_',
            caughtErrors: 'all',
            caughtErrorsIgnorePattern: '^_',
            destructuredArrayIgnorePattern: '^_',
            varsIgnorePattern: '^_',
            ignoreRestSiblings: true,
          }],
          'import/no-named-as-default-member': 'off',
        },
      },
    ],
  },
  // Test files
  {
    files: ['test/**/*.ts'],
    rules: {
      // @playwright/test likes empty object patterns. (It ASTs the test fns internally.)
      'no-empty-pattern': ['error', { allowObjectPatternsAsParameters: true }],
      // We prefer consistency and readability over the tiny performance gain of avoiding async in test files.
      '@typescript-eslint/require-await': 'off',
    },
  },
  // Markdown code blocks
  markdown.configs.processor,
  {
    files: ['*.md/**/*.{js,ts}'],
    extends: [
      // Disable type checks until eslint and typescript can interop better.
      // https://github.com/eslint/markdown/tree/main/examples/typescript
      tseslint.configs.disableTypeChecked,
    ],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      ...Object.fromEntries(Object.keys(importPlugin.flatConfigs.recommended.rules).map(ruleName => [ruleName, 'off'])),
    },
  },
)
