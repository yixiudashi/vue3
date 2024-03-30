import {
  activeEffect,
  shouldTrack,
  trackEffect,
  triggerEffects,
} from './effect'
import { DirtyLevels } from './constants'
import {
  hasChanged,
} from '@vue/shared'
import {
  toRaw,
  toReactive,
} from './reactive'
import { type Dep, createDep } from './dep'
import { ComputedRefImpl } from './computed'

declare const RefSymbol: unique symbol
export declare const RawSymbol: unique symbol

export interface Ref<T = any> {
  value: T
  /**
   * Type differentiator only.
   * We need this to be in public d.ts but don't want it to show up in IDE
   * autocomplete, so we use a private Symbol instead.
   */
  [RefSymbol]: true
}

type RefBase<T> = {
  dep?: Dep
  value: T
}

export function trackRefValue(ref: RefBase<any>) {
  if (shouldTrack && activeEffect) {
    ref = toRaw(ref)
    trackEffect(
      activeEffect,
      (ref.dep ??= createDep(
        () => (ref.dep = undefined),
        ref instanceof ComputedRefImpl ? ref : undefined,
      )),
      void 0,
    )
  }
}

export function triggerRefValue(
  ref: RefBase<any>,
  dirtyLevel: DirtyLevels = DirtyLevels.Dirty,
  newVal?: any,
) {
  ref = toRaw(ref)
  const dep = ref.dep
  if (dep) {
    triggerEffects(
      dep,
      dirtyLevel,
      void 0,
    )
  }
}

export function isRef<T>(r: Ref<T> | unknown): r is Ref<T>
export function isRef(r: any): r is Ref {
  return !!(r && r.__v_isRef === true)
}

export function ref<T>(value: T): Ref<UnwrapRef<T>>
export function ref<T = any>(): Ref<T | undefined>
export function ref(value?: unknown) {
  return createRef(value)
}

function createRef(rawValue: unknown) {
  if (isRef(rawValue)) {
    return rawValue
  }
  return new RefImpl(rawValue)
}

class RefImpl<T> {
  private _value: T
  private _rawValue: T

  public dep?: Dep = undefined
  public readonly __v_isRef = true

  constructor(
    value: T,
  ) {
    this._rawValue = toRaw(value)
    this._value = toReactive(value)
  }

  get value() {
    trackRefValue(this)
    return this._value
  }

  set value(newVal) {
    newVal = toRaw(newVal)
    if (hasChanged(newVal, this._rawValue)) {
      this._rawValue = newVal
      this._value = toReactive(newVal)
      triggerRefValue(this, DirtyLevels.Dirty, newVal)
    }
  }
}

// corner case when use narrows type
// Ex. type RelativePath = string & { __brand: unknown }
// RelativePath extends object -> true
type BaseTypes = string | number | boolean

export interface RefUnwrapBailTypes {}

export type UnwrapRef<T> =
  T extends Ref<infer V>
    ? UnwrapRefSimple<V>
    : UnwrapRefSimple<T>

export type UnwrapRefSimple<T> = T extends
  | Function
  | BaseTypes
  | Ref
  | RefUnwrapBailTypes[keyof RefUnwrapBailTypes]
  | { [RawSymbol]?: true }
  ? T
  : T extends Map<infer K, infer V>
    ? Map<K, UnwrapRefSimple<V>> & UnwrapRef<Omit<T, keyof Map<any, any>>>
    : T extends WeakMap<infer K, infer V>
      ? WeakMap<K, UnwrapRefSimple<V>> &
          UnwrapRef<Omit<T, keyof WeakMap<any, any>>>
      : T extends Set<infer V>
        ? Set<UnwrapRefSimple<V>> & UnwrapRef<Omit<T, keyof Set<any>>>
        : T extends WeakSet<infer V>
          ? WeakSet<UnwrapRefSimple<V>> & UnwrapRef<Omit<T, keyof WeakSet<any>>>
          : T extends object
            ? {
                [P in keyof T]: P extends symbol ? T[P] : UnwrapRef<T[P]>
              }
            : T
