/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the deployed telemetry worker, e.g. https://telemetry.orbinum.io */
  readonly VITE_API_BASE?: string;
  /** Genesis hash of testnet; the Testnet tab is hidden without it. */
  readonly VITE_TESTNET_GENESIS?: string;
  /** Genesis hash of mainnet; the Mainnet tab is hidden without it. */
  readonly VITE_MAINNET_GENESIS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
