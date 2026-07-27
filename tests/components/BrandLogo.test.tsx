import { describe, test, expect } from 'vitest'
import { render } from '@testing-library/react'
import { BrandLogo } from '@/components/ui/BrandLogo'

describe('BrandLogo', () => {
  test('renders with default wrapper class logo-mark', () => {
    const { container } = render(<BrandLogo />)

    const wrapper = container.querySelector('.logo-mark')
    expect(wrapper).toBeInTheDocument()
    expect(wrapper?.classList.contains('logo-mark')).toBe(true)
  })

  test('renders logo text with textContent "NewsListen"', () => {
    const { container } = render(<BrandLogo />)

    const logoText = container.querySelector('.logo-text')
    expect(logoText).toBeInTheDocument()
    expect(logoText?.textContent).toBe('NewsListen')
  })

  test('renders inner span with textContent "Listen"', () => {
    const { container } = render(<BrandLogo />)

    const logoText = container.querySelector('.logo-text')
    const listenSpan = logoText?.querySelector('span')
    expect(listenSpan).toBeInTheDocument()
    expect(listenSpan?.textContent).toBe('Listen')
  })

  test('renders SVG glyph with aria-hidden="true"', () => {
    const { container } = render(<BrandLogo />)

    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  test('applies custom wrapperClassName when provided', () => {
    const { container } = render(<BrandLogo wrapperClassName="modal-logo" />)

    const wrapper = container.querySelector('.modal-logo')
    expect(wrapper).toBeInTheDocument()
    expect(wrapper?.classList.contains('modal-logo')).toBe(true)
    expect(wrapper?.classList.contains('logo-mark')).toBe(false)
  })
})
