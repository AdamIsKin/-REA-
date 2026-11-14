import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/**
 * 密码哈希（设计文档 4.1：Node 内置 crypto.scrypt，每个用户独立加盐，不依赖原生模块）。
 *
 * scrypt 是“内存困难”的 KDF：参数 N=2^15、r=8 时每次计算约需 32 MB 内存、几十毫秒，
 * 对登录这种低频操作无感，但让离线暴力破解的成本高出几个数量级。
 * 存储格式自描述：`scrypt$N$r$p$salt$hash`（Base64），以后调高参数时旧哈希仍可验证。
 *
 * 原系统 mfsystem_user.user_pass 为 char(64)，存储方式未知；新系统不沿用。
 */
const N = 1 << 15
const R = 8
const P = 1
const KEYLEN = 32
// Node 默认 maxmem 为 32 MB，N=2^15、r=8 恰好需要 128*N*r = 32 MB，需要留出余量。
const MAXMEM = 64 * 1024 * 1024

export function hashPassword(plain: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(plain.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM })
  return ['scrypt', N, R, P, salt.toString('base64'), hash.toString('base64')].join('$')
}

/** 常量时间比较，防止通过响应时间差逐字节猜出哈希。格式不合法一律视为不匹配。 */
export function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string]
  const expected = Buffer.from(hashB64, 'base64')
  const actual = scryptSync(plain.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: MAXMEM,
  })
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
