import { NOOP, extend } from '@vue/shared'
import type { ComputedRefImpl } from './computed'
import {
  DirtyLevels,
  type TrackOpTypes,
  type TriggerOpTypes,
} from './constants'
import type { Dep } from './dep'
import { type EffectScope, recordEffectScope } from './effectScope'

export type EffectScheduler = (...args: any[]) => any

export type DebuggerEvent = {
  effect: ReactiveEffect
} & DebuggerEventExtraInfo

export type DebuggerEventExtraInfo = {
  target: object
  type: TrackOpTypes | TriggerOpTypes
  key: any
  newValue?: any
  oldValue?: any
  oldTarget?: Map<any, any> | Set<any>
}

export let activeEffect: ReactiveEffect | undefined

export class ReactiveEffect<T = any> {
  active = true
  deps: Dep[] = []

  /**
   * Can be attached after creation
   * @internal
   */
  computed?: ComputedRefImpl<T>
  /**
   * @internal
   */
  allowRecurse?: boolean

  onStop?: () => void

  /**
   * @internal
   */
  _dirtyLevel = DirtyLevels.Dirty
  /**
   * @internal
   */
  _trackId = 0
  /**
   * @internal
   */
  _runnings = 0
  /**
   * @internal
   */
  _shouldSchedule = false
  /**
   * @internal
   */
  _depsLength = 0

  constructor(
    public fn: () => T,
    public trigger: () => void, // 用于触发副作用函数的调度
    public scheduler?: EffectScheduler,
    scope?: EffectScope,
  ) {
    recordEffectScope(this, scope)
  }

  public get dirty() { // 除了 return this._dirtyLevel >= DirtyLevels.Dirty，其他代码都是为了确保计算属性的依赖关系
    if (
      this._dirtyLevel === DirtyLevels.MaybeDirty
    ) {
      this._dirtyLevel = DirtyLevels.QueryingDirty
      pauseTracking()
      for (let i = 0; i < this._depsLength; i++) {
        const dep = this.deps[i]
        if (dep.computed) {
          triggerComputed(dep.computed)
          if (this._dirtyLevel >= DirtyLevels.Dirty) {
            break
          }
        }
      }
      if (this._dirtyLevel === DirtyLevels.QueryingDirty) {
        this._dirtyLevel = DirtyLevels.NotDirty
      }
      resetTracking()
    }
    return this._dirtyLevel >= DirtyLevels.Dirty
  }

  public set dirty(v) {
    this._dirtyLevel = v ? DirtyLevels.Dirty : DirtyLevels.NotDirty
  }

  run() {
    this._dirtyLevel = DirtyLevels.NotDirty
    if (!this.active) { // 副作用已经停止，不在进行依赖的收集管理，直接运行返回
      return this.fn()
    }
    let lastShouldTrack = shouldTrack // 记录当前是否需要追踪副作用依赖的标志位
    let lastEffect = activeEffect // 记录当前正在运行的副作用
    try {
      shouldTrack = true // 为即将执行的副作用追踪依赖
      activeEffect = this // 标记即将运行的副作用
      this._runnings++
      preCleanupEffect(this)
      return this.fn()
    } finally {
      postCleanupEffect(this)
      this._runnings--
      activeEffect = lastEffect
      shouldTrack = lastShouldTrack
    }
  }

  stop() {
    if (this.active) {
      preCleanupEffect(this)
      postCleanupEffect(this)
      this.onStop?.()
      this.active = false
    }
  }
}

function triggerComputed(computed: ComputedRefImpl<any>) {
  return computed.value
}

function preCleanupEffect(effect: ReactiveEffect) { // 为重新记录依赖做准备
  effect._trackId++
  effect._depsLength = 0
}

function postCleanupEffect(effect: ReactiveEffect) { // 清理多余的依赖(上一次运行收集的依赖比这次多)
  if (effect.deps.length > effect._depsLength) {
    for (let i = effect._depsLength; i < effect.deps.length; i++) {
      cleanupDepEffect(effect.deps[i], effect)
    }
    effect.deps.length = effect._depsLength
  }
}

function cleanupDepEffect(dep: Dep, effect: ReactiveEffect) {
  const trackId = dep.get(effect)
  if (trackId !== undefined && effect._trackId !== trackId) { // 接触依赖与副作用的关系
    dep.delete(effect)
    if (dep.size === 0) { // 当某个依赖没有任何副作用依赖时，主动清理依赖对应的Dep对象
      dep.cleanup()
    }
  }
}

export interface ReactiveEffectOptions {
  lazy?: boolean
  scheduler?: EffectScheduler
  scope?: EffectScope
  allowRecurse?: boolean
  onStop?: () => void
}

export interface ReactiveEffectRunner<T = any> {
  (): T
  effect: ReactiveEffect
}

export function effect<T = any>(
  fn: () => T,
  options?: ReactiveEffectOptions,
): ReactiveEffectRunner {
  if ((fn as ReactiveEffectRunner).effect instanceof ReactiveEffect) {
    fn = (fn as ReactiveEffectRunner).effect.fn
  }

  const _effect = new ReactiveEffect(fn, NOOP, () => {
    if (_effect.dirty) {
      _effect.run()
    }
  })
  if (options) {
    extend(_effect, options)
    if (options.scope) recordEffectScope(_effect, options.scope)
  }
  if (!options || !options.lazy) {
    _effect.run()
  }
  const runner = _effect.run.bind(_effect) as ReactiveEffectRunner
  runner.effect = _effect
  return runner
}

/**
 * Stops the effect associated with the given runner.
 *
 * @param runner - Association with the effect to stop tracking.
 */
export function stop(runner: ReactiveEffectRunner) {
  runner.effect.stop()
}

export let shouldTrack = true // 是否需要追踪副作用依赖的标志位
export let pauseScheduleStack = 0 // 暂停调度次数

const trackStack: boolean[] = [] // 用于记录副作用收集与否的栈

/**
 * Temporarily pauses tracking.
 */
export function pauseTracking() {
  trackStack.push(shouldTrack)
  shouldTrack = false
}

/**
 * Re-enables effect tracking (if it was paused).
 */
export function enableTracking() {
  trackStack.push(shouldTrack)
  shouldTrack = true
}

/**
 * Resets the previous global effect tracking state.
 */
export function resetTracking() {
  const last = trackStack.pop()
  shouldTrack = last === undefined ? true : last
}

export function pauseScheduling() { // 暂停调度，确保将所有的副作用函数加入队列
  pauseScheduleStack++
}

export function resetScheduling() { // 完成所有的副作用函数的手机后，集中一次性调度
  pauseScheduleStack--
  while (!pauseScheduleStack && queueEffectSchedulers.length) {
    queueEffectSchedulers.shift()!()
  }
}

// 1.这里承担了副作用相关依赖的更新(条件逻辑下，每次运行完成后的依赖可能不一样)
// 2.还有当某个依赖没有任何副作用依赖时，主动清理依赖对应的Dep对象
export function trackEffect(
  effect: ReactiveEffect,
  dep: Dep,
) {
  if (dep.get(effect) !== effect._trackId) {
    dep.set(effect, effect._trackId)
    const oldDep = effect.deps[effect._depsLength]
    if (oldDep !== dep) {
      if (oldDep) {
        cleanupDepEffect(oldDep, effect)
      }
      effect.deps[effect._depsLength++] = dep
    } else {
      effect._depsLength++
    }
  }
}

const queueEffectSchedulers: EffectScheduler[] = []

// 以下代码不用一次了解细节，只需要知道，响应式数据的变化，找到对应的副作用，将副作用函数加入到队列中
// queueEffectSchedulers.push(effect.scheduler)
export function triggerEffects(
  dep: Dep,
  dirtyLevel: DirtyLevels,
) {
  pauseScheduling() // 暂停调度，确保将所有的副作用函数加入队列
  for (const effect of dep.keys()) {
    // dep.get(effect) is very expensive, we need to calculate it lazily and reuse the result
    let tracking: boolean | undefined
    if (
      effect._dirtyLevel < dirtyLevel && // 只有在分析计算属性的时候，_dirtyLevel才有用，一般情况下可以将_dirtyLevel看待为bool值
      (tracking ??= dep.get(effect) === effect._trackId) // 在副作用函数运行时触发了依赖的变化，避免陷入死循环
    ) {
      effect._shouldSchedule ||= effect._dirtyLevel === DirtyLevels.NotDirty
      effect._dirtyLevel = dirtyLevel
    }
    if (
      effect._shouldSchedule &&
      (tracking ??= dep.get(effect) === effect._trackId)
    ) {
      effect.trigger() // 这里只是明确当前副作用的触发，而非真正的运行，与computed/customeRef 有关
      if (
        (!effect._runnings || effect.allowRecurse)) { // 正在运行的副作用函数，不会再次触发将当前副作用函数加入队列，除非明确允许递归
        effect._shouldSchedule = false
        if (effect.scheduler) {
          queueEffectSchedulers.push(effect.scheduler) // 将副作用函数的调度器加入队列
        }
      }
    }
  }
  resetScheduling() // 恢复调度
}
