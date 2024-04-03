import {
  type Target,
  reactive,
  reactiveMap,
  toRaw,
} from './reactive'
import { ReactiveFlags, TrackOpTypes, TriggerOpTypes } from './constants'
import {
  pauseScheduling,
  pauseTracking,
  resetScheduling,
  resetTracking,
} from './effect'
import { ITERATE_KEY, track, trigger } from './reactiveEffect'
import {
  hasChanged,
  hasOwn,
  isArray,
  isIntegerKey,
  isObject,
  isSymbol,
  makeMap,
} from '@vue/shared'
import { isRef } from './ref'

const isNonTrackableKeys = /*#__PURE__*/ makeMap(`__proto__,__v_isRef,__isVue`)

const builtInSymbols = new Set(
  /*#__PURE__*/
  Object.getOwnPropertyNames(Symbol)
    // ios10.x Object.getOwnPropertyNames(Symbol) can enumerate 'arguments' and 'caller'
    // but accessing them on Symbol leads to TypeError because Symbol is a strict mode
    // function
    .filter(key => key !== 'arguments' && key !== 'caller')
    .map(key => (Symbol as any)[key])
    .filter(isSymbol),
)

const arrayInstrumentations = /*#__PURE__*/ createArrayInstrumentations()

function createArrayInstrumentations() {
  const instrumentations: Record<string, Function> = {}
  // 重写数组的方法，使其能够追踪数组的变化
  ;(['includes', 'indexOf', 'lastIndexOf'] as const).forEach(key => { // 读取操作，追踪数组上每一个元素包括length
    instrumentations[key] = function (this: unknown[], ...args: unknown[]) {
      const arr = toRaw(this) as any
      for (let i = 0, l = this.length; i < l; i++) {
        track(arr, TrackOpTypes.GET, i + '')
      }
      // we run the method using the original args first (which may be reactive)
      const res = arr[key](...args)
      if (res === -1 || res === false) {
        // if that didn't work, run it again using raw values.
        return arr[key](...args.map(toRaw))
      } else {
        return res
      }
    }
  })
  // instrument length-altering mutation methods to avoid length being tracked
  // which leads to infinite loops in some cases (#2137)
  ;(['push', 'pop', 'shift', 'unshift', 'splice'] as const).forEach(key => { // 修改操作，触发对应的副作用
    instrumentations[key] = function (this: unknown[], ...args: unknown[]) {
      pauseTracking() // 暂停追踪, 因为这些方法的修改操作，js内部会有读取操作，不去为这里的读取操作建议依赖追踪
      pauseScheduling() // 暂停调度，以上操作或导致多次变更，集中一次性调度
      const res = (toRaw(this) as any)[key].apply(this, args)
      resetScheduling()
      resetTracking()
      return res
    }
  })
  return instrumentations
}

function hasOwnProperty(this: object, key: string) {
  const obj = toRaw(this)
  track(obj, TrackOpTypes.HAS, key)
  return obj.hasOwnProperty(key)
}

export const mutableHandlers: ProxyHandler<object> = {
  get(target: Target, key: string | symbol, receiver: object) {
    if (key === ReactiveFlags.RAW) { // 获取原始对象
      if (receiver === reactiveMap.get(target)) {
        return target
      }
      return
    }

    const targetIsArray = isArray(target)
    if (targetIsArray && hasOwn(arrayInstrumentations, key)) { // 获取数组的方法
      return Reflect.get(arrayInstrumentations, key, receiver)
    }
    if (key === 'hasOwnProperty') { // 获取 hasOwnProperty 方法
      return hasOwnProperty
    }
    // 以上不用过多关心，主要是为了处理数组的方法和 hasOwnProperty 方法

    const res = Reflect.get(target, key, receiver) // 获取属性值

    if (isSymbol(key) ? builtInSymbols.has(key) : isNonTrackableKeys(key)) {// 不需要追踪的属性
      return res
    }

    track(target, TrackOpTypes.GET, key) // 追踪属性, 将属性与当前运行的副作用关联

    if (isRef(res)) { // reactive里面的ref，自动解包，此特性最初与渲染函数有关，不用过多关心
      res.value
    }

    if (isObject(res)) { // 递归处理，保证所有属性都是响应式的，vue3采用的是按需处理，当获取属性时才会处理
      return reactive(res)
    }

    return res
  },

  set(
    target: object,
    key: string | symbol,
    value: unknown,
    receiver: object,
  ): boolean {
    let oldValue = (target as any)[key]

    oldValue = toRaw(oldValue)
    value = toRaw(value)

    // 可不用强行理解细节，此特性最初与渲染函数有关，只需要知道是为了处理ref的情况
    if (!isArray(target) && isRef(oldValue) && !isRef(value)) {
      oldValue.value = value
      return true
    }
    // 判断是否有这个属性
    const hadKey =
      isArray(target) && isIntegerKey(key)
        ? Number(key) < target.length
        : hasOwn(target, key)
    const result = Reflect.set(target, key, value, receiver) // 设置属性值
    // don't trigger if target is something up in the prototype chain of original
    if (target === toRaw(receiver)) {
      if (!hadKey) {
        trigger(target, TriggerOpTypes.ADD, key, value) // 新增属性，触发对应的副作用
      } else if (hasChanged(value, oldValue)) {
        trigger(target, TriggerOpTypes.SET, key, value) // 修改属性，触发对应的副作用
      }
    }
    return result
  },
  // 删除属性，触发对应的副作用
  deleteProperty(target: object, key: string | symbol): boolean {
    const hadKey = hasOwn(target, key)
    const result = Reflect.deleteProperty(target, key)
    if (result && hadKey) {
      trigger(target, TriggerOpTypes.DELETE, key, undefined)
    }
    return result
  },
  // 判断是否有这个属性, 追踪属性, 将属性与当前运行的副作用关联
  has(target: object, key: string | symbol): boolean {
    const result = Reflect.has(target, key)
    if (!isSymbol(key) || !builtInSymbols.has(key)) {
      track(target, TrackOpTypes.HAS, key)
    }
    return result
  },
  // 获取属性名列表, 追踪iterate, 将iterate与当前运行的副作用关联
  ownKeys(target: object): (string | symbol)[] {
    track(
      target,
      TrackOpTypes.ITERATE,
      isArray(target) ? 'length' : ITERATE_KEY,
    )
    return Reflect.ownKeys(target)
  }
}
