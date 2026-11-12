export default {
  extends: ['stylelint-config-recommended'],
  rules: {
    // Feature blocks intentionally override earlier selectors in cascade order.
    'no-duplicate-selectors': null,
  },
};
