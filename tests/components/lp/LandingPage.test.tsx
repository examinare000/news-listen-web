import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { LandingPage } from '@/components/lp/LandingPage'

describe('LandingPage', () => {
  test('renders the hero with catch copy and data-testid="lp-hero"', () => {
    render(<LandingPage onLoginClick={vi.fn()} />)
    const hero = screen.getByTestId('lp-hero')
    expect(hero).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: '今日の海外テックニュースを、聴く英語学習に。' }),
    ).toBeInTheDocument()
  })

  test('renders all 4 feature cards', () => {
    render(<LandingPage onLoginClick={vi.fn()} />)
    expect(screen.getByText('パーソナライズドフィード')).toBeInTheDocument()
    expect(screen.getByText('ワンタップでPodcast生成')).toBeInTheDocument()
    expect(screen.getByText('日本語イントロ+英語本文')).toBeInTheDocument()
    expect(screen.getByText('6段階の難易度')).toBeInTheDocument()
  })

  test('primary and header signup CTAs link to /signup', () => {
    render(<LandingPage onLoginClick={vi.fn()} />)
    const signupLinks = screen.getAllByRole('link', { name: /新規登録|招待コードで登録/ })
    expect(signupLinks.length).toBeGreaterThanOrEqual(2)
    for (const link of signupLinks) {
      expect(link).toHaveAttribute('href', '/signup')
    }
  })

  test('calls onLoginClick when the header login button is clicked', async () => {
    const onLoginClick = vi.fn()
    render(<LandingPage onLoginClick={onLoginClick} />)

    await userEvent.click(screen.getAllByRole('button', { name: 'ログイン' })[0])

    expect(onLoginClick).toHaveBeenCalledTimes(1)
  })

  test('calls onLoginClick when the hero secondary login button is clicked', async () => {
    const onLoginClick = vi.fn()
    render(<LandingPage onLoginClick={onLoginClick} />)

    const loginButtons = screen.getAllByRole('button', { name: 'ログイン' })
    await userEvent.click(loginButtons[loginButtons.length - 1])

    expect(onLoginClick).toHaveBeenCalledTimes(1)
  })

  test('renders the footer copyright', () => {
    render(<LandingPage onLoginClick={vi.fn()} />)
    expect(screen.getByText('© 2026 news-listen')).toBeInTheDocument()
  })
})
