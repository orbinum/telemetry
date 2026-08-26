/**
 * The shape of a request as the routes see it.
 *
 * `Variables` is where the composed dependencies arrive, put there once per
 * request by the wiring in the entry point. Routes read `deps` and never touch
 * `Bindings`, which is what keeps them from naming a platform type.
 */

import type { AppDeps } from "./adapters/cloudflare/composition";

export interface AppEnv {
  Bindings: CloudflareBindings;
  Variables: { deps: AppDeps };
}
