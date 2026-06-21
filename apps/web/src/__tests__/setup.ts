// vitest 全局 setup —— jsdom 默认不提供 matchMedia, 单测里 theme.ts 需要。
// 给一个稳定可控的 mq 对象, 让单测可以切换 systemDark。

import { vi } from 'vitest'

class MediaQueryListMock {
  matches: boolean
  media: string
  onchange: ((this: MediaQueryList, ev: MediaQueryListEvent) => any) | null = null
  private listeners = new Set<(ev: MediaQueryListEvent) => void>()

  constructor(media: string, matches: boolean) {
    this.media = media
    this.matches = matches
  }

  addEventListener(_type: 'change', listener: (ev: MediaQueryListEvent) => void): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'change', listener: (ev: MediaQueryListEvent) => void): void {
    this.listeners.delete(listener)
  }

  dispatchEvent(_event: Event): boolean {
    return true
  }

  /** 测试 helper: 触发所有监听器, 模拟系统主题切换 */
  __triggerChange(newMatches: boolean) {
    this.matches = newMatches
    for (const listener of this.listeners) {
      listener({ matches: newMatches, media: this.media } as MediaQueryListEvent)
    }
  }
}

export const mqMock = new MediaQueryListMock('(prefers-color-scheme: dark)', false)

if (typeof window !== 'undefined') {
  // jsdom 不提供 matchMedia, 用 vi.fn 模拟 (返回 mock instance)
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => mqMock)
  })
}