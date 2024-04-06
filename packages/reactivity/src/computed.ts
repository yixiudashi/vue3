import { ReactiveEffect } from './effect'
import { trackRefValue, triggerRefValue } from './ref'
import { hasChanged } from '@vue/shared'
import { toRaw } from './reactive'
import type { Dep } from './dep'
import { DirtyLevels } from './constants'

declare const ComputedRefSymbol: unique symbol

export interface ComputedRef<T = any> {
  readonly value: T
  [ComputedRefSymbol]: true
}

export type ComputedGetter<T> = (oldValue?: T) => T

export class ComputedRefImpl<T> {
  public dep?: Dep = undefined // 用于记录计算属性的依赖

  private _value!: T // 计算属性缓存的值
  public readonly effect: ReactiveEffect<T> // 计算函数对应的副作用

  public readonly __v_isRef = true // 用于标记当前对象是一个Ref对象

  /**
   * Dev only
   */
  _warnRecursive?: boolean

  constructor(private getter: ComputedGetter<T>) {
    this.effect = new ReactiveEffect(
      () => getter(this._value), // 计算属性的执行函数作为副作用的执行函数
      () => triggerRefValue(this, DirtyLevels.MaybeDirty), // 当计算属性依赖的响应式对象发生变化时，通知依赖当前计算属性的副作用需要重新执行，实现了按需执行
    )
    this.effect.computed = this
  }

  get value() {
    // the computed ref may get wrapped by other proxies e.g. readonly() #3376
    const self = toRaw(this)
    if (
      self.effect.dirty &&
      hasChanged(self._value, (self._value = self.effect.run()!)) // 确认计算属性的值是否发生变化
    ) {
      triggerRefValue(self, DirtyLevels.Dirty) // 通知依赖当前计算属性的副作用需要重新执行
    }
    trackRefValue(self)
    return self._value
  }

  set value(newValue: T) {}

  // #region polyfill _dirty for backward compatibility third party code for Vue <= 3.3.x
  get _dirty() {
    return this.effect.dirty
  }

  set _dirty(v) {
    this.effect.dirty = v
  }
  // #endregion
}

export function computed<T>(getter: ComputedGetter<T>): ComputedRef<T> {
  const cRef = new ComputedRefImpl(getter)

  return cRef as any
}
