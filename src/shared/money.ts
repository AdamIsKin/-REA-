/**
 * 金额与数量（R20 / D14）。
 *
 * 金额一律用整数“分”、数量一律用整数“件”：
 * - JS number 是 IEEE754 双精度，0.1 + 0.2 !== 0.3，用“元”的小数做加减会累积误差；
 * - 整数在 ±2^53 内完全精确，单店金额远达不到这个上限（约 900 万亿元）。
 *
 * 用“品牌类型”（branded type）把 Cents / Qty 与普通 number 区分开，
 * 编译期就能拦住“把元当分”“把数量当金额”这类混用，运行时零开销。
 */
export type Cents = number & { readonly __brand: 'Cents' }
export type Qty = number & { readonly __brand: 'Qty' }

/** 显式标记一个整数为分；只应在“数据来源可信”（数据库读出、已校验的计算结果）处调用。 */
export const cents = (n: number): Cents => n as Cents
export const qty = (n: number): Qty => n as Qty

/** “元”字符串的合法格式：可选负号，整数部分，最多两位小数。 */
const YUAN_RE = /^(-)?(\d{1,13})(?:\.(\d{1,2}))?$/

/**
 * 把“元”字符串解析成分；格式不合法返回 null。
 *
 * 不用 `Math.round(parseFloat(s) * 100)`：例如 1.005 * 100 = 100.49999…，会被错误地舍成 100。
 * 这里直接按字符串拆整数和小数两段，再做整数运算，结果总是精确的。
 */
export function parseYuan(input: string): Cents | null {
  const m = YUAN_RE.exec(input.trim())
  if (!m) return null
  const intPart = Number(m[2])
  const fracPart = Number((m[3] ?? '').padEnd(2, '0'))
  const abs = intPart * 100 + fracPart
  return cents(m[1] ? -abs : abs)
}

/**
 * 分 → “元”显示字符串（固定两位小数），只用于显示，不参与任何计算（设计文档 11.2）。
 * 同样走整数运算，避免 `(n / 100).toFixed(2)` 在个别值上的二进制舍入问题。
 */
export function formatCents(value: number): string {
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  const yuan = Math.trunc(abs / 100)
  const fen = abs % 100
  return `${sign}${yuan}.${fen.toString().padStart(2, '0')}`
}

/**
 * 按比例分摊并四舍五入到分：round(total × part ÷ whole)。
 *
 * 成本引擎（8.3 / 8.5）的核心算子。用 BigInt 做中间乘法：
 * total × part 在极端情况下可能超过 2^53 而丢精度，BigInt 保证乘法精确；
 * 再以“加半个除数后整除”实现四舍五入（half-up，对非负数与 Math.round 一致）。
 * 调用方保证 0 ≤ part ≤ whole、whole > 0；total 可正可负（负数按绝对值舍入后取负，保证对称）。
 */
export function prorate(total: number, part: number, whole: number): number {
  if (whole <= 0) throw new RangeError('prorate: whole 必须大于 0')
  if (part === whole) return total
  const neg = total < 0
  const t = BigInt(Math.abs(total))
  const p = BigInt(part)
  const w = BigInt(whole)
  const r = Number((t * p * 2n + w) / (w * 2n))
  return neg ? -r : r
}
