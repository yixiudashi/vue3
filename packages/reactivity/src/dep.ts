import type { ReactiveEffect, ReactiveEffectTrackId } from './effect'
import type { ComputedRefImpl } from './computed'

// 记录响应式对应关联的副作用
export type Dep = Map<ReactiveEffect, ReactiveEffectTrackId> & {
  cleanup: () => void
  computed?: ComputedRefImpl<any>
}

export const createDep = (
  cleanup: () => void,
  computed?: ComputedRefImpl<any>, // 计算属性对象
): Dep => {
  const dep = new Map() as Dep
  dep.cleanup = cleanup
  dep.computed = computed
  return dep
}
