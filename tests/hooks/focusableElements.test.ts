import { describe, test, expect } from 'vitest'
import { getFocusableElements, FOCUSABLE_SELECTOR } from '@/hooks/focusableElements'

// ==========================================================
// getFocusableElements — フォーカス可能要素の列挙
// - 空コンテナ / null / 様々な要素型 / disabled / hidden / aria-hidden / tabindex=-1
// - タブ順に列挙されることを検証
// ==========================================================
describe('getFocusableElements', () => {
  describe('Given null or falsy container', () => {
    test('returns empty array when container is null', () => {
      const result = getFocusableElements(null)
      expect(result).toEqual([])
    })

    test('returns empty array when container is undefined', () => {
      const result = getFocusableElements(undefined as unknown as HTMLElement | null)
      expect(result).toEqual([])
    })
  })

  describe('Given empty container', () => {
    test('returns empty array when container has no children', () => {
      const container = document.createElement('div')
      const result = getFocusableElements(container)
      expect(result).toEqual([])
    })
  })

  describe('Given various focusable element types', () => {
    test('includes links with href attribute', () => {
      const container = document.createElement('div')
      const link = document.createElement('a')
      link.href = '/test'
      container.appendChild(link)

      const result = getFocusableElements(container)
      expect(result).toContain(link)
    })

    test('excludes links without href attribute', () => {
      const container = document.createElement('div')
      const link = document.createElement('a')
      container.appendChild(link)

      const result = getFocusableElements(container)
      expect(result).not.toContain(link)
    })

    test('includes enabled buttons', () => {
      const container = document.createElement('div')
      const button = document.createElement('button')
      container.appendChild(button)

      const result = getFocusableElements(container)
      expect(result).toContain(button)
    })

    test('excludes disabled buttons', () => {
      const container = document.createElement('div')
      const button = document.createElement('button')
      button.disabled = true
      container.appendChild(button)

      const result = getFocusableElements(container)
      expect(result).not.toContain(button)
    })

    test('includes enabled input elements', () => {
      const container = document.createElement('div')
      const input = document.createElement('input')
      container.appendChild(input)

      const result = getFocusableElements(container)
      expect(result).toContain(input)
    })

    test('excludes disabled input elements', () => {
      const container = document.createElement('div')
      const input = document.createElement('input')
      input.disabled = true
      container.appendChild(input)

      const result = getFocusableElements(container)
      expect(result).not.toContain(input)
    })

    test('includes enabled select elements', () => {
      const container = document.createElement('div')
      const select = document.createElement('select')
      container.appendChild(select)

      const result = getFocusableElements(container)
      expect(result).toContain(select)
    })

    test('excludes disabled select elements', () => {
      const container = document.createElement('div')
      const select = document.createElement('select')
      select.disabled = true
      container.appendChild(select)

      const result = getFocusableElements(container)
      expect(result).not.toContain(select)
    })

    test('includes enabled textarea elements', () => {
      const container = document.createElement('div')
      const textarea = document.createElement('textarea')
      container.appendChild(textarea)

      const result = getFocusableElements(container)
      expect(result).toContain(textarea)
    })

    test('excludes disabled textarea elements', () => {
      const container = document.createElement('div')
      const textarea = document.createElement('textarea')
      textarea.disabled = true
      container.appendChild(textarea)

      const result = getFocusableElements(container)
      expect(result).not.toContain(textarea)
    })
  })

  describe('Given elements with tabindex attributes', () => {
    test('includes elements with tabindex="0"', () => {
      const container = document.createElement('div')
      const div = document.createElement('div')
      div.setAttribute('tabindex', '0')
      container.appendChild(div)

      const result = getFocusableElements(container)
      expect(result).toContain(div)
    })

    test('includes elements with positive tabindex', () => {
      const container = document.createElement('div')
      const div = document.createElement('div')
      div.setAttribute('tabindex', '1')
      container.appendChild(div)

      const result = getFocusableElements(container)
      expect(result).toContain(div)
    })

    test('excludes elements with tabindex="-1"', () => {
      const container = document.createElement('div')
      const div = document.createElement('div')
      div.setAttribute('tabindex', '-1')
      container.appendChild(div)

      const result = getFocusableElements(container)
      expect(result).not.toContain(div)
    })

    test('excludes elements with tabindex set to any negative value', () => {
      const container = document.createElement('div')
      const div = document.createElement('div')
      div.setAttribute('tabindex', '-2')
      container.appendChild(div)

      const result = getFocusableElements(container)
      expect(result).not.toContain(div)
    })
  })

  describe('Given elements with hidden attributes', () => {
    test('excludes elements with hidden attribute', () => {
      const container = document.createElement('div')
      const button = document.createElement('button')
      button.hidden = true
      container.appendChild(button)

      const result = getFocusableElements(container)
      expect(result).not.toContain(button)
    })

    test('includes elements without hidden attribute', () => {
      const container = document.createElement('div')
      const button = document.createElement('button')
      container.appendChild(button)

      const result = getFocusableElements(container)
      expect(result).toContain(button)
    })
  })

  describe('Given elements with aria-hidden attribute', () => {
    test('excludes elements with aria-hidden="true"', () => {
      const container = document.createElement('div')
      const button = document.createElement('button')
      button.setAttribute('aria-hidden', 'true')
      container.appendChild(button)

      const result = getFocusableElements(container)
      expect(result).not.toContain(button)
    })

    test('includes elements with aria-hidden="false"', () => {
      const container = document.createElement('div')
      const button = document.createElement('button')
      button.setAttribute('aria-hidden', 'false')
      container.appendChild(button)

      const result = getFocusableElements(container)
      expect(result).toContain(button)
    })

    test('includes elements without aria-hidden attribute', () => {
      const container = document.createElement('div')
      const button = document.createElement('button')
      container.appendChild(button)

      const result = getFocusableElements(container)
      expect(result).toContain(button)
    })
  })

  describe('Given nested focusable elements', () => {
    test('returns elements in document order', () => {
      const container = document.createElement('div')
      const button1 = document.createElement('button')
      button1.id = 'btn1'
      const button2 = document.createElement('button')
      button2.id = 'btn2'
      const button3 = document.createElement('button')
      button3.id = 'btn3'

      container.appendChild(button1)
      container.appendChild(button2)
      container.appendChild(button3)

      const result = getFocusableElements(container)
      expect(result[0]).toBe(button1)
      expect(result[1]).toBe(button2)
      expect(result[2]).toBe(button3)
    })

    test('includes deeply nested focusable elements', () => {
      const container = document.createElement('div')
      const nested = document.createElement('div')
      const button = document.createElement('button')

      nested.appendChild(button)
      container.appendChild(nested)

      const result = getFocusableElements(container)
      expect(result).toContain(button)
    })
  })

  describe('Given mixed focusable and non-focusable elements', () => {
    test('returns only focusable elements, excluding disabled and hidden', () => {
      const container = document.createElement('div')

      const button1 = document.createElement('button')
      button1.id = 'btn1'
      container.appendChild(button1)

      const disabledButton = document.createElement('button')
      disabledButton.disabled = true
      container.appendChild(disabledButton)

      const input = document.createElement('input')
      input.id = 'input1'
      container.appendChild(input)

      const hiddenInput = document.createElement('input')
      hiddenInput.hidden = true
      container.appendChild(hiddenInput)

      const link = document.createElement('a')
      link.href = '/test'
      link.id = 'link1'
      container.appendChild(link)

      const linkNoHref = document.createElement('a')
      container.appendChild(linkNoHref)

      const result = getFocusableElements(container)
      expect(result).toContain(button1)
      expect(result).not.toContain(disabledButton)
      expect(result).toContain(input)
      expect(result).not.toContain(hiddenInput)
      expect(result).toContain(link)
      expect(result).not.toContain(linkNoHref)
    })
  })

  describe('FOCUSABLE_SELECTOR constant', () => {
    test('selector is defined and is a string', () => {
      expect(typeof FOCUSABLE_SELECTOR).toBe('string')
      expect(FOCUSABLE_SELECTOR.length).toBeGreaterThan(0)
    })
  })
})
