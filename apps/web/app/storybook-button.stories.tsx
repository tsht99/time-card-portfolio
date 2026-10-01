import { Button } from "@repo/ui/components/button";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

const meta = {
  title: "UI/Button",
  component: Button,
  args: {
    children: "打刻する",
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Secondary: Story = {
  args: {
    children: "キャンセル",
    variant: "secondary",
  },
};
