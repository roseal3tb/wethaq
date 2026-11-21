/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'true' connects the dashboard to the Wethaq API and the Hyperledger Fabric network */
  readonly VITE_WETHAQ_LIVE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
