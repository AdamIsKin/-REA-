import JsBarcode from 'jsbarcode'

export interface BarcodeLabel {
  /** 条码内容（优先商品条码，否则编码）。 */
  code: string
  name: string
  priceText?: string
}

/**
 * 条码标签 HTML（设计文档 U6 暂定 40×30mm）。
 * JsBarcode 画到临时 SVG，再内联进 HTML；主进程打印窗口禁用 JS，故必须先转成静态 SVG。
 */
export function buildBarcodeLabelsHtml(labels: BarcodeLabel[]): string {
  const cards = labels
    .map((l) => {
      const svg = barcodeSvg(l.code)
      return `<div class="label">
        <div class="name">${esc(l.name)}</div>
        ${svg}
        <div class="code">${esc(l.code)}</div>
        ${l.priceText ? `<div class="price">${esc(l.priceText)}</div>` : ''}
      </div>`
    })
    .join('')

  return `<!doctype html><html><head><meta charset="utf-8"/>
<style>
  @page { size: 40mm 30mm; margin: 0 }
  body { margin: 0; font-family: "Microsoft YaHei", sans-serif; color: #000 }
  .label {
    width: 40mm; height: 30mm; box-sizing: border-box;
    padding: 1.5mm 2mm; page-break-after: always;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
  }
  .name { font-size: 9px; max-width: 36mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
  .code { font-size: 9px; margin-top: 0.5mm }
  .price { font-size: 11px; font-weight: 700 }
  svg { max-width: 36mm; height: 12mm }
</style></head><body>${cards}</body></html>`
}

function barcodeSvg(value: string): string {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  try {
    JsBarcode(svg, value, {
      format: 'CODE128',
      displayValue: false,
      margin: 0,
      width: 1.2,
      height: 40,
    })
  } catch {
    // 非法字符时 CODE128 会抛错：退化成纯文本，避免整批标签失败。
    return `<div class="code">${esc(value)}</div>`
  }
  return svg.outerHTML
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
