import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import TermsPage from '@/app/terms/page'

describe('TermsPage', () => {
  test('renders the page title', () => {
    render(<TermsPage />)
    expect(screen.getByRole('heading', { name: /利用規約/ })).toBeInTheDocument()
  })

  test('contains service overview section', () => {
    render(<TermsPage />)
    expect(screen.getByText(/招待制.*無償.*英語学習/)).toBeInTheDocument()
  })

  test('contains user responsibility section for RSS feeds', () => {
    render(<TermsPage />)
    expect(screen.getByText(/ユーザーがRSSフィードを/)).toBeInTheDocument()
  })

  test('contains CC BY-SA 4.0 license mention for generated podcasts', () => {
    render(<TermsPage />)
    expect(screen.getByText(/CC BY-SA 4\.0/)).toBeInTheDocument()
  })

  test('limits the CC BY-SA 4.0 license to featured-sourced podcasts (ADR-095)', () => {
    render(<TermsPage />)
    expect(
      screen.getByText(/運営者が提示する適合ライセンスのソース.*featured.*ポッドキャスト/)
    ).toBeInTheDocument()
  })

  test('states user-added RSS podcasts are not covered by the license (ADR-095)', () => {
    render(<TermsPage />)
    expect(
      screen.getByText(/利用者が任意に追加したRSSフィード.*本人のみ.*対象外.*再配布はできません/)
    ).toBeInTheDocument()
  })

  test('does not contain the old blanket license statement (ADR-095)', () => {
    render(<TermsPage />)
    expect(screen.queryByText(/本サービスが提供するポッドキャスト/)).not.toBeInTheDocument()
  })

  test('contains takedown notice email link (examinare000@gmail.com)', () => {
    render(<TermsPage />)
    const emailLink = screen.getByRole('link', { name: /examinare000@gmail\.com/ })
    expect(emailLink).toHaveAttribute('href', 'mailto:examinare000@gmail.com')
  })

  test('contains disclaimer section', () => {
    render(<TermsPage />)
    expect(screen.getByRole('heading', { name: '免責' })).toBeInTheDocument()
    expect(screen.getByText(/正確性|完全性/)).toBeInTheDocument()
  })

  test('contains the effective date 2026-08-29', () => {
    render(<TermsPage />)
    expect(screen.getByText(/2026-08-29/)).toBeInTheDocument()
  })
})
