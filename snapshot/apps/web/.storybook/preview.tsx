import type { Preview } from "@storybook/nextjs-vite";

import "../app/globals.css";

const preview: Preview = {
  parameters: {
    nextjs: {
      appDirectory: true,
    },
    viewport: {
      options: {
        mobile320: {
          name: "320px",
          styles: { width: "320px", height: "568px" },
          type: "mobile",
        },
        mobile390: {
          name: "390px",
          styles: { width: "390px", height: "844px" },
          type: "mobile",
        },
        mobile448: {
          name: "448px",
          styles: { width: "448px", height: "998px" },
          type: "mobile",
        },
      },
    },
  },
  initialGlobals: {
    viewport: { value: "mobile390", isRotated: false },
  },
};

export default preview;
