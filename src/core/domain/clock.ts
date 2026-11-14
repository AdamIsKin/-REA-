/**
 * 时钟抽象：业务日期“不能晚于今天”（R6）依赖当前日期，
 * 通过注入时钟，测试可以固定“今天”，结果不随运行日期变化。
 */
export interface Clock {
  /** 本机时区的今天，'YYYY-MM-DD'。 */
  today(): string
  /** 当前时间，ISO 8601（UTC），用于 created_at 等记录时间。 */
  now(): string
}

const pad = (n: number): string => n.toString().padStart(2, '0')

/** 按本机系统时区取日期（R6）。不能用 toISOString().slice(0,10)：那是 UTC 日期，东八区凌晨会差一天。 */
export const localDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export const systemClock: Clock = {
  today: () => localDate(new Date()),
  now: () => new Date().toISOString(),
}

/** 测试用固定时钟。 */
export const fixedClock = (today: string, now = `${today}T00:00:00.000Z`): Clock => ({
  today: () => today,
  now: () => now,
})
