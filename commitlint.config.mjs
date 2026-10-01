export default {
  extends: ["@commitlint/config-conventional"],
  plugins: [
    {
      rules: {
        "subject-japanese": ({ subject }) => [
          /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/u.test(subject ?? ""),
          "subject must contain at least one kanji, hiragana, or katakana character",
        ],
      },
    },
  ],
  rules: {
    "scope-empty": [2, "always"],
    "subject-case": [0, "always"],
    "subject-japanese": [2, "always"],
  },
};
