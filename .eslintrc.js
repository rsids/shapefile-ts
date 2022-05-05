module.exports = {
  root:true,
  env: {
    browser: true,
    es6: true,
    mocha: true
  },
  extends: ["eslint:recommended", 'plugin:@typescript-eslint/recommended', "prettier"],
  plugins: [
    '@typescript-eslint','prettier']
};
