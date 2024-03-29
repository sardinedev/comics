/// <reference types="astro/client" />

type KVNamespace = import("@cloudflare/workers-types/experimental").KVNamespace;
type ENV = {
  SERVER_URL: string;
  COMICS: KVNamespace;
};

type Runtime = import("@astrojs/cloudflare").AdvancedRuntime<ENV>;

declare namespace App {
  interface Locals extends Runtime {
    user: {
      name: string;
      surname: string;
    };
  }
}
