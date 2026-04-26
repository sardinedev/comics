import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";

const srcRoot = fileURLToPath(new URL("src/", import.meta.url));

const aliases = [
  { find: /^@components\/(.*)/, replacement: `${srcRoot}components/$1` },
  { find: /^@layouts\/(.*)/, replacement: `${srcRoot}layouts/$1` },
  { find: /^@util\/(.*)/, replacement: `${srcRoot}util/$1` },
  { find: /^@data\/(.*)/, replacement: `${srcRoot}data/$1` },
  { find: /^@lib\/(.*)/, replacement: `${srcRoot}lib/$1` },
];

export default defineConfig({
  resolve: { alias: aliases },
  test: {
    projects: [
      {
        resolve: { alias: aliases },
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.browser.test.{ts,tsx}"],
        },
      },
      {
        resolve: {
          alias: aliases,
          dedupe: ["preact", "preact/hooks", "@preact/signals"],
        },
        optimizeDeps: {
          include: [
            "preact",
            "preact/hooks",
            "preact/jsx-runtime",
            "preact/jsx-dev-runtime",
            "@preact/signals",
            "vitest-browser-preact",
          ],
        },
        test: {
          name: "browser",
          include: ["src/**/*.browser.test.{ts,tsx}"],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});

