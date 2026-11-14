/// <reference types="vite/client" />
// window.api 的类型来自 src/preload/api.d.ts（已在 tsconfig.web.json 的 include 中）。

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

declare module 'element-plus/es/locale/lang/zh-cn' {
  const locale: import('element-plus/es/locale').Language
  export default locale
}

declare module 'jsbarcode' {
  interface JsBarcodeOptions {
    format?: string
    displayValue?: boolean
    margin?: number
    width?: number
    height?: number
  }
  function JsBarcode(
    element: SVGElement | HTMLCanvasElement | string,
    data: string,
    options?: JsBarcodeOptions,
  ): void
  export default JsBarcode
}
