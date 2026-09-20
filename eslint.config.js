// The architecture's dependency rules and the house style, enforced.
// Zones are listed from the innermost layer outwards; a layer may only import
// the layers above it in this list.
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importX from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

const zone = (target, from) => ({
  target: `./src/${target}`,
  from: `./src/${from}`,
  message: `${target} must not depend on ${from}`,
});

const forbidden = {
  domain: ['ports', 'application', 'adapters', 'infra', 'cli', 'composition'],
  ports: ['application', 'adapters', 'infra', 'cli', 'composition'],
  application: ['adapters', 'infra', 'cli', 'composition'],
  adapters: ['application', 'infra', 'cli', 'composition'],
  infra: ['application', 'adapters', 'cli', 'composition'],
  cli: ['adapters', 'infra'],
};

const zones = Object.entries(forbidden).flatMap(([target, froms]) =>
  froms.map((from) => zone(target, from)),
);

// Inner layers may calculate paths and fingerprints, but all IO goes through
// ports. YAML/Zod are allowed only in the declarative configuration codecs.
const innerImports = (codecs = false) => ({
  patterns: [
    {
      regex: `^(?!(?:\\.{1,2}/|node:(?:path(?:/posix|/win32)?|crypto)$${codecs ? '|(?:yaml|zod)$' : ''}))`,
      message: 'Inner layers use ports for IO and domain codecs for configuration formats.',
    },
  ],
});

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'docs/website/dist/', 'docs/website/node_modules/'] },
  ...tseslint.configs.recommended,
  {
    // src's two JavaScript modules are shared with scripts that run before a
    // build; the type-checked project covers them and the delivery scripts, so
    // the layering and style rules reach all of them too.
    files: ['**/*.ts', 'src/**/*.js', 'scripts/**/*.mjs'],
    languageOptions: {
      parserOptions: { project: './tsconfig.all.json', tsconfigRootDir: import.meta.dirname },
    },
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver-next': [
        createTypeScriptImportResolver({ project: './tsconfig.all.json' }),
      ],
    },
    rules: {
      'import-x/no-restricted-paths': ['error', { zones }],
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-nested-ternary': 'error',
      eqeqeq: 'error',
    },
  },
  {
    files: ['src/**/*.{ts,js}'],
    rules: {
      'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // JSDoc, not annotations, declares the boundary types in src's JavaScript.
    files: ['src/**/*.ts'],
    rules: { '@typescript-eslint/explicit-module-boundary-types': 'error' },
  },
  {
    files: ['src/domain/**/*.{ts,js}', 'src/application/**/*.{ts,js}', 'src/ports/**/*.{ts,js}'],
    rules: {
      'no-restricted-imports': ['error', innerImports()],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression',
          message: 'Load optional implementations in adapters or composition, not inner layers.',
        },
      ],
    },
  },
  {
    files: [
      'src/domain/manifest/**/*.ts',
      'src/domain/config/**/*.ts',
      'src/domain/import/render.ts',
    ],
    rules: { 'no-restricted-imports': ['error', innerImports(true)] },
  },
  {
    // A fake records calls so a test can say which ones ran, not in what
    // position; `vectors()` states that the order itself is the contract.
    files: ['test/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[computed=true][object.property.name='calls']",
          message: 'Select a recorded call by its vector, not by its position.',
        },
        {
          selector:
            "CallExpression[callee.property.name='at'][callee.object.property.name='calls']",
          message: 'Select a recorded call by its vector, not by its position.',
        },
      ],
    },
  },
);
