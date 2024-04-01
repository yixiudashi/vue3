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
      () => getter(this._value),
      () => triggerRefValue(this, DirtyLevels.MaybeDirty),
    )
    this.effect.computed = this
  }

  get value() {
    // the computed ref may get wrapped by other proxies e.g. readonly() #3376
    const self = toRaw(this)
    if (
      self.effect.dirty &&
      hasChanged(self._value, (self._value = self.effect.run()!))
    ) {
      triggerRefValue(self, DirtyLevels.Dirty)
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
