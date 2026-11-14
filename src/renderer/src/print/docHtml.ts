import { DOC_TYPE_LABEL, type DocDetail } from '@shared/dto'
import { formatCents } from '@shared/money'

/** 单据打印 HTML（设计文档 4.1）：纯 HTML，条码由调用方先转成内联 SVG。 */

export function buildDocPrintHtml(doc: DocDetail, shop: { name: string; phone: string; address: string; footer: string }): string {
  const lines = doc.lines
    .map(
      (l) => `<tr>
        <td>${l.lineNo}</td>
        <td>${esc(l.itemCode)}</td>
        <td>${esc(l.itemName)}</td>
        <td class="num">${l.qty}</td>
        <td class="num">${formatCents(l.unitPrice)}</td>
        <td class="num">${formatCents(l.amount)}</td>
        <td>${esc(l.serials.join(' '))}</td>
      </tr>`,
    )
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"/>
<style>
  body{font-family:"Microsoft YaHei",sans-serif;font-size:12px;color:#000;margin:16px}
  h1{font-size:18px;text-align:center;margin:0 0 8px}
  .meta{margin-bottom:12px}
  .meta span{display:inline-block;min-width:40%;margin:2px 0}
  table{width:100%;border-collapse:collapse}
  th,td{border:1px solid #333;padding:4px 6px}
  th{background:#f0f0f0}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  .foot{margin-top:16px;color:#444}
</style></head><body>
  <h1>${esc(shop.name || '库存管理')} · ${DOC_TYPE_LABEL[doc.docType]}</h1>
  <div class="meta">
    <span>单号：${esc(doc.docNo)}</span>
    <span>日期：${esc(doc.bizDate)}</span>
    <span>仓库：${esc(doc.warehouseName)}${doc.toWarehouseName ? ' → ' + esc(doc.toWarehouseName) : ''}</span>
    <span>往来：${esc(doc.partnerName ?? '')}</span>
    ${doc.refDocNo ? `<span>原单：${esc(doc.refDocNo)}</span>` : ''}
  </div>
  <table>
    <thead><tr><th>行</th><th>编码</th><th>名称</th><th>数量</th><th>单价</th><th>金额</th><th>串号</th></tr></thead>
    <tbody>${lines}</tbody>
  </table>
  <div class="foot">
    <div>合计数量：${doc.totalQty}　合计金额：${formatCents(doc.totalAmount)}</div>
    <div>${esc(shop.phone)} ${esc(shop.address)}</div>
    <div>${esc(shop.footer)}</div>
  </div>
</body></html>`
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
