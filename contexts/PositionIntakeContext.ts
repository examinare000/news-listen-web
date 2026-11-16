'use client'

// 一覧・詳細の取得が見た位置を、再生側の取り込みへ渡す入口。catalog は playback を import せず、この Context 越しに関数だけを受ける。
import { createContext, useContext } from 'react'
import type { PositionIntake } from '@/lib/playback/application/positionOutbox'

// Provider の外（server render・PlaybackProvider なし）用。useMemo の依存になるので module に 1 つだけ持つ。
const IGNORE_ITEMS = (): void => undefined
export const NO_INTAKE: PositionIntake = Object.freeze({ capture: () => IGNORE_ITEMS })

export const PositionIntakeContext = createContext<PositionIntake>(NO_INTAKE)

export function usePositionIntake(): PositionIntake {
  return useContext(PositionIntakeContext)
}
