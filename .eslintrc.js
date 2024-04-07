/* eslint-env node */
import '@rushstack/eslint-patch/modern-module-resolution'

export default {
    root: true,
    env: {
        node: true
    },
    'extends': [
        'eslint:recommended',
        'plugin:import/recommended'
    ],
    parserOptions: {
        ecmaVersion: 'latest'
    }
}
