export default {
  extends: ['stylelint-config-recommended'],
  overrides: [
    {
      files: ['src/styles.css'],
      rules: {
        // Feature blocks intentionally override earlier rules in cascade order.
        'no-duplicate-selectors': null,
        'no-descending-specificity': null,
      },
    },
  ],
};
