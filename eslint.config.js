import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/', 'node_modules/'] },

  js.configs.recommended,

  {
    files: ['src/client/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.browser,
    },
  },

  {
    files: ['src/client/vendor/**/*.js'],
    rules: { 'no-unused-vars': 'off', 'no-empty': 'off' },
  },

  /** The PCM capture worklet runs on the audio thread, which has its own globals. */
  {
    files: ['public/pcm-worklet.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        ...globals.worker,
        sampleRate: 'readonly',
        currentTime: 'readonly',
        registerProcessor: 'readonly',
        AudioWorkletProcessor: 'readonly',
      },
    },
  },

  {
    files: ['src/server/**/*.js', 'test/**/*.js', 'vite.config.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
  },

  {
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      /** `ignoreRestSiblings`, so stripping a key by destructuring it out reads
       *  as what it is rather than as a variable nobody used. */
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        caughtErrors: 'none',
        ignoreRestSiblings: true,
      }],
    },
  },
];
