// @ts-check

import { defineConfig } from "cspell";

export default defineConfig({
  language: "en",
  useGitignore: true,
  enableGlobDot: true,
  dictionaryDefinitions: [
    {
      name: "project-words",
      path: "./.cspell/project-words.txt",
    },
  ],
  dictionaries: ["project-words"],
  ignorePaths: [
    ".git/**",
    "pnpm-lock.yaml",
    "packages/db/migrations/**",
    ".cspell/project-words.txt",
  ],
});
