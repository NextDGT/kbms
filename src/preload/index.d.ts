import type { KbmsApi } from './index'

declare global {
  interface Window {
    kbms: KbmsApi
  }
}

export {}
