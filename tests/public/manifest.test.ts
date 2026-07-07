import { describe, test, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

/**
 * PWA インストール要件の検証（issue #167）。
 * name/icons/start_url/display は Chrome/Android のインストール条件
 * （Add to Home Screen / beforeinstallprompt）に必須。
 */
describe('public/manifest.json — PWA installability', () => {
  const manifestPath = join(__dirname, '../../public/manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
    name?: string
    short_name?: string
    display?: string
    start_url?: string
    scope?: string
    background_color?: string
    theme_color?: string
    icons?: Array<{ src: string; sizes: string; type: string; purpose?: string }>
  }

  test('has a non-empty name', () => {
    expect(manifest.name).toBeTruthy()
  })

  test('has display standalone (required for install prompt)', () => {
    expect(manifest.display).toBe('standalone')
  })

  test('has start_url "/"', () => {
    expect(manifest.start_url).toBe('/')
  })

  test('has scope "/"', () => {
    expect(manifest.scope).toBe('/')
  })

  test('has at least a 192x192 and a 512x512 icon with type image/png', () => {
    const sizes = (manifest.icons ?? []).map((icon) => icon.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
    for (const icon of manifest.icons ?? []) {
      expect(icon.type).toBe('image/png')
    }
  })

  test('has a maskable 512x512 icon for adaptive Android launcher icons', () => {
    const maskable = (manifest.icons ?? []).find(
      (icon) => icon.sizes === '512x512' && icon.purpose === 'maskable',
    )
    expect(maskable).toBeDefined()
  })

  test('every declared icon file exists under public/', () => {
    const publicDir = join(__dirname, '../../public')
    for (const icon of manifest.icons ?? []) {
      const iconPath = join(publicDir, icon.src.replace(/^\//, ''))
      expect(existsSync(iconPath), `${icon.src} should exist`).toBe(true)
    }
  })
})
