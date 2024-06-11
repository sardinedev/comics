import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import preact from "@astrojs/preact";
import node from "@astrojs/node";

// https://astro.build/config
export default defineConfig({
  output: "server",
  integrations: [tailwind(), preact()],
  adapter: node({
    mode: "standalone",
  }),
  vite: {
    server: {
      host: "0.0.0.0",
      hmr: { clientPort: 3000 },
      port: 3000,
      watch: { usePolling: true },
    },
  },
});
