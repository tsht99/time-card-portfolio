import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: new URL(".env.local", import.meta.url) });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/*.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
