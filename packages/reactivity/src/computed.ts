import { ReactiveEffect } from './effect'
import { type Ref, trackRefValue, triggerRefValue } from './ref'
import { hasChanged } from '@vue/shared'
import { toRaw } from './reactive'
import type { Dep } from './dep'
import { DirtyLevels, ReactiveFlags } from './constants'

declare const ComputedRefSymbol: unique symbol

export interface ComputedRef<T = any> extends WritableComputedRef<T> {
  readonly value: T
  [ComputedRefSymbol]: true
}

export interface WritableComputedRef<T> extends Ref<T> {
  readonly effect: ReactiveEffect<T>
}

export type ComputedGetter<T> = (oldValue?: T) => T
export type ComputedSetter<T> = (newValue: T) => void

export class ComputedRefImpl<T> {
  public dep?: Dep = undefined

  private _value!: T
  public readonly effect: ReactiveEffect<T>

  public readonly __v_isRef = true
  public readonly [ReactiveFlags.IS_READONLY]: boolean = true

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
