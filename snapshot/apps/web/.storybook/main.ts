import type { StorybookConfig } from "@storybook/nextjs-vite";

const config: StorybookConfig = {
  stories: [
    "../app/**/*.stories.@(ts|tsx)",
    "../../../packages/ui/src/**/*.stories.@(ts|tsx)",
  ],
  addons: ["@storybook/addon-a11y", "@storybook/addon-vitest"],
  framework: "@storybook/nextjs-vite",
  staticDirs: [],
  viteFinal: async (viteConfig) => {
    viteConfig.define = {
      ...viteConfig.define,
      "process.env.NEXT_PUBLIC_HELP_URL": JSON.stringify(
        "https://help.example.test",
      ),
    };
    return viteConfig;
  },
};

export default config;
