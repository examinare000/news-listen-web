'use client'

import React, { useEffect } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { formatDuration } from '@/lib/format'

// 文言は shared-dec-42 で確定済み。受入の grep が固定の文字列で探すので、分けずに連続した文字列で置く。
const TITLE = 'どちらの位置から続けますか'
const REMOTE_PREFIX = '別の端末: '
const LOCAL_PREFIX = ' ／ この端末: '
const CHOOSE_REMOTE = '別の端末の位置から'
const CHOOSE_LOCAL = 'この端末の位置から'
const CLOSE = '閉じる'

interface ResumeChoiceDialogProps {
  isOpen: boolean
  remoteSeconds: number
  localSeconds: number
  onChooseRemote: () => void
  onChooseLocal: () => void
  onClose: () => void
}

// ConfirmDialog は 2 択（確認・キャンセル）の文言を持つので流用せず、同じ作りで 3 つのボタンを持つ（web-dec-166）。
export function ResumeChoiceDialog({
  isOpen,
  remoteSeconds,
  localSeconds,
  onChooseRemote,
  onChooseLocal,
  onClose,
}: ResumeChoiceDialogProps) {
  const dialogRef = useFocusTrap<HTMLDivElement>(isOpen)

  useEffect(() => {
    if (!isOpen) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="modal-backdrop">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="resume-choice-dialog-title"
        className="modal-box"
      >
        <h2 id="resume-choice-dialog-title" className="modal-title">
          {TITLE}
        </h2>
        <p className="modal-desc">
          {`${REMOTE_PREFIX}${formatDuration(remoteSeconds)}${LOCAL_PREFIX}${formatDuration(localSeconds)}`}
        </p>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onChooseRemote}>
            {CHOOSE_REMOTE}
          </button>
          <button className="btn btn-primary" onClick={onChooseLocal}>
            {CHOOSE_LOCAL}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            {CLOSE}
          </button>
        </div>
      </div>
    </div>
  )
}
