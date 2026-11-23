import type { SettingDescriptor } from '@/lib/preferences/domain/settings'
import type { LocalSettingsStorage } from './ports'

export interface LocalSettings {
  readonly get: <T>(setting: SettingDescriptor<T>) => T
  readonly set: <T>(setting: SettingDescriptor<T>, value: T) => void
  readonly clearSubjectScoped: () => void
  readonly subscribe: (listener: () => void) => () => void
  readonly version: () => number
}

export function createLocalSettings(input: {
  readonly storage: LocalSettingsStorage
  readonly settings: readonly SettingDescriptor<unknown>[]
}): LocalSettings {
  const { storage, settings } = input
  const values = new Map<SettingDescriptor<unknown>, unknown>()
  for (const setting of settings) {
    values.set(setting, storage.read<unknown>(setting))
  }
  const listeners = new Set<() => void>()
  let version = 0

  // version を通知より先に増やす。購読側（useSyncExternalStore）は通知の中で同期に version を読んで比べる。
  const publish = (): void => {
    version += 1
    for (const listener of [...listeners]) listener()
  }

  return {
    get: <T,>(setting: SettingDescriptor<T>): T =>
      // values は登録済みの記述子から作った値だけを持ち、値は同じ記述子の normalize 済みなので T である。
      values.has(setting) ? (values.get(setting) as T) : setting.default,
    set: <T,>(setting: SettingDescriptor<T>, value: T): void => {
      if (!values.has(setting)) return
      values.set(setting, storage.write(setting, value))
      publish()
    },
    clearSubjectScoped: (): void => {
      for (const setting of settings) {
        if (setting.subjectScoped) values.set(setting, setting.default)
      }
      storage.clearSubjectScoped()
      publish()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    version: () => version,
  }
}
