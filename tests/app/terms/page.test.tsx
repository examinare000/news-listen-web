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
