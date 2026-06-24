import { describe, test, expect } from 'vitest'
import { resolveResumePosition } from '@/lib/playbackPosition'

// ==========================================================
// resolveResumePosition — server position優先
// ==========================================================
describe('resolveResumePosition', () => {
  test('Given server position > 0, returns server position', () => {
    const result = resolveResumePosition(120, 90)
    expect(result).toBe(120)
  })

  test('Given server position = 0 but local position > 0, returns local position', () => {
    const result = resolveResumePosition(0, 90)
    expect(result).toBe(90)
  })

  test('Given both server and local = 0, returns 0', () => {
    const result = resolveResumePosition(0, 0)
    expect(result).toBe(0)
  })

  test('Given negative server position, uses local if positive', () => {
    const result = resolveResumePosition(-10, 90)
    expect(result).toBe(90)
  })

  test('Given negative server and local, returns 0 (clamped)', () => {
    const result = resolveResumePosition(-10, -5)
    expect(result).toBe(0)
  })

  test('Given negative local but positive server, returns server', () => {
    const result = resolveResumePosition(120, -10)
    expect(result).toBe(120)
  })

  test('Given large positions, maintains values', () => {
    const result = resolveResumePosition(3600, 2700)
    expect(result).toBe(3600)
  })
})
