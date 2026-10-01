import type { StorybookConfig } from "@storybook/nextjs-vite";

const config: StorybookConfig = {
  stories: ["../**/*.stories.@(ts|tsx)"],
  addons: [],
  framework: "@storybook/nextjs-vite",
  staticDirs: [],
};

export default config;
