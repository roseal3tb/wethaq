/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'true' connects the dashboard to the Wethaq API and the Hyperledger Fabric network */
  readonly VITE_WETHAQ_LIVE?: string;
  /** Origin of the Wethaq API when it is not served under /api on the dashboard's own origin (live mode only) */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
