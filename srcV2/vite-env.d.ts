/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENTRA_CLIENT_ID: string
  readonly VITE_ENTRA_TENANT_ID: string
  readonly VITE_ENTRA_AUTHORITY: string
  readonly VITE_API_URL?: string
  readonly BASE_URL: string
  readonly MODE: string
  readonly DEV: boolean
  readonly PROD: boolean
  readonly SSR: boolean
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}
