module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  extends: [
    "eslint:recommended",
    "google",
  ],
  parserOptions: {
    ecmaVersion: "latest",
  },
  ignorePatterns: [
    "node_modules/",
    "lib/",
    "coverage/",
  ],
  rules: {
    "require-jsdoc": "off",
    "max-len": ["error", {code: 120, ignoreUrls: true, ignoreTemplateLiterals: true}],
    quotes: ["error", "double", {allowTemplateLiterals: true, avoidEscape: true}],
    "operator-linebreak": "off",
    indent: "off",
    "object-curly-spacing": "off",
    "comma-dangle": "off",
  },
};
