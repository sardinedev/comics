import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const srcRoot = fileURLToPath(new URL("src/", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@components\/(.*)/, replacement: `${srcRoot}components/$1` },
      { find: /^@layouts\/(.*)/, replacement: `${srcRoot}layouts/$1` },
      { find: /^@util\/(.*)/, replacement: `${srcRoot}util/$1` },
      { find: /^@data\/(.*)/, replacement: `${srcRoot}data/$1` },
      { find: /^@lib\/(.*)/, replacement: `${srcRoot}lib/$1` },
    ],
  },
  test: {
    environment: "node",
  },
});
