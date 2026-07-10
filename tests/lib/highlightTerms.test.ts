import { describe, test, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'
import { highlightTerms } from '@/lib/highlightTerms'

// WHY render via React.createElement (no JSX) instead of a .test.tsx file: the design doc
// specifies this file as tests/lib/highlightTerms.test.ts, and highlightTerms returns
// React.ReactNode[] — we can verify the resulting DOM without needing JSX syntax ourselves.
function renderNodes(nodes: React.ReactNode[]) {
  return render(React.createElement(React.Fragment, null, nodes))
}

describe('highlightTerms', () => {
  test('wraps an exact term match in a <mark> element', () => {
    const { container } = renderNodes(highlightTerms('The cat sat on the mat.', ['cat']))

    const marks = container.querySelectorAll('mark')
    expect(marks).toHaveLength(1)
    expect(marks[0]).toHaveTextContent('cat')
  })

  test('matches case-insensitively', () => {
    const { container } = renderNodes(highlightTerms('The Cat sat on the mat.', ['cat']))

    const marks = container.querySelectorAll('mark')
    expect(marks).toHaveLength(1)
    expect(marks[0]).toHaveTextContent('Cat')
  })

  test('does not match a term that is only a substring of a larger word', () => {
    const { container } = renderNodes(highlightTerms('We will start soon.', ['art']))

    expect(container.querySelectorAll('mark')).toHaveLength(0)
    expect(container).toHaveTextContent('We will start soon.')
  })

  test('does not crash on terms containing regex special characters', () => {
    expect(() =>
      renderNodes(highlightTerms('Cost is $5.00 (approx.) per unit.', ['$5.00', '(approx.)']))
    ).not.toThrow()
  })

  test('highlights a term containing regex special characters', () => {
    const { container } = renderNodes(
      highlightTerms('Cost is $5.00 (approx.) per unit.', ['$5.00'])
    )

    const marks = container.querySelectorAll('mark')
    expect(marks).toHaveLength(1)
    expect(marks[0]).toHaveTextContent('$5.00')
  })

  test('returns the original text unchanged when terms is empty', () => {
    const { container } = renderNodes(highlightTerms('Nothing to highlight here.', []))

    expect(container.querySelectorAll('mark')).toHaveLength(0)
    expect(container).toHaveTextContent('Nothing to highlight here.')
  })

  test('highlights multiple distinct terms in the same text', () => {
    const { container } = renderNodes(
      highlightTerms('The quick brown fox jumps over the lazy dog.', ['fox', 'dog'])
    )

    const marks = container.querySelectorAll('mark')
    expect(marks).toHaveLength(2)
    expect(marks[0]).toHaveTextContent('fox')
    expect(marks[1]).toHaveTextContent('dog')
  })

  test('prefers matching a longer phrase over a shorter contained term', () => {
    const { container } = renderNodes(
      highlightTerms('Global climate change is accelerating.', ['climate change', 'climate'])
    )

    const marks = container.querySelectorAll('mark')
    expect(marks).toHaveLength(1)
    expect(marks[0]).toHaveTextContent('climate change')
  })

  test('does not produce duplicate React key warnings for repeated matches', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    renderNodes(highlightTerms('cat cat cat', ['cat']))

    const keyWarnings = errorSpy.mock.calls.filter((args) =>
      String(args[0]).includes('unique "key"')
    )
    expect(keyWarnings).toHaveLength(0)

    errorSpy.mockRestore()
  })
})
