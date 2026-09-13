import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import PrivacyPage from '@/app/privacy/page'

describe('PrivacyPage', () => {
  test('renders the page title', () => {
    render(<PrivacyPage />)
    expect(screen.getByRole('heading', { name: /プライバシーポリシー/ })).toBeInTheDocument()
  })

  test('describes collected information', () => {
    render(<PrivacyPage />)
    expect(screen.getByRole('heading', { name: '収集する情報' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '認証情報' })).toBeInTheDocument()
  })

  test('mentions Google Cloud services (Firestore, Cloud Storage, TTS)', () => {
    render(<PrivacyPage />)
    expect(screen.getByText('Firestore')).toBeInTheDocument()
    expect(screen.getByText('Cloud Storage')).toBeInTheDocument()
    expect(screen.getByText(/音声化|音声合成/)).toBeInTheDocument()
  })

  test('explicitly states article text is sent to Google Gemini API', () => {
    render(<PrivacyPage />)
    expect(screen.getByRole('heading', { name: 'Google Gemini API' })).toBeInTheDocument()
    expect(screen.getByText(/記事本文をGoogle Gemini APIに送信/)).toBeInTheDocument()
  })

  test('contains contact email (examinare000@gmail.com)', () => {
    render(<PrivacyPage />)
    const emailLink = screen.getByRole('link', { name: /examinare000@gmail\.com/ })
    expect(emailLink).toHaveAttribute('href', 'mailto:examinare000@gmail.com')
  })

  test('mentions data retention and account erasure', () => {
    render(<PrivacyPage />)
    expect(screen.getByRole('heading', { name: 'データ保持と削除' })).toBeInTheDocument()
    expect(screen.getByText(/ユーザーがアカウントを削除/)).toBeInTheDocument()
  })
})
