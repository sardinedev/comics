import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import cloudflare from "@astrojs/cloudflare";

import preact from "@astrojs/preact";

// https://astro.build/config
export default defineConfig({
  output: "server",
  integrations: [tailwind(), preact()],
  adapter: cloudflare({
    runtime: {
      mode: "local",
      type: "pages",
      bindings: {
        COMICS: {
          type: "kv"
        }
      }
    }
  })
});