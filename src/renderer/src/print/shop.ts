import { call } from '../api'

/** 打印抬头：与设置页同一批键，缺省时空串，模板里会回退到产品名。 */
export interface ShopPrintInfo {
  name: string
  phone: string
  address: string
  footer: string
}

export async function loadShopPrintInfo(): Promise<ShopPrintInfo> {
  const all = await call('setting:getAll', {})
  return {
    name: all['shop.name'] ?? '',
    phone: all['shop.phone'] ?? '',
    address: all['shop.address'] ?? '',
    footer: all['print.footer'] ?? '',
  }
}
