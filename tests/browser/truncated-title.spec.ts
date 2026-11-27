import { expect, test } from './test'

test('sets full-text title on hover and focus for truncated elements while preserving native tooltips', async ({ page }) => {
  await page.goto('/privacy')
  await page.waitForFunction(() => document.querySelector('[data-truncated-test]') === null)

  await page.evaluate(() => {
    const host = document.createElement('div')
    host.setAttribute('data-truncated-test', 'true')
    host.style.cssText = 'position: fixed; top: 8rem; left: 2rem; z-index: 10000; padding: 1.6rem; background: var(--bg-base); display: flex; flex-direction: column; gap: 1.2rem; width: 460px;'

    const single = document.createElement('div')
    single.id = 'trunc-single'
    single.style.cssText = 'width: 140px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 14px;'
    single.textContent = 'Extremely Long Channel Name That Gets Cut Off On Narrow Sidebars'

    const clamp = document.createElement('div')
    clamp.id = 'trunc-clamp'
    clamp.style.cssText = 'width: 160px; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; font-size: 14px; line-height: 20px;'
    clamp.textContent = 'First sentence is visible and continues onto the second line and then overflows past line three and line four.'

    const notTrunc = document.createElement('div')
    notTrunc.id = 'trunc-fit'
    notTrunc.style.cssText = 'width: 400px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 14px;'
    notTrunc.textContent = 'Short title fits easily'

    const explicit = document.createElement('div')
    explicit.id = 'trunc-native'
    explicit.title = 'Existing native tooltip'
    explicit.style.cssText = 'width: 120px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 14px;'
    explicit.textContent = 'Long text that already carries an explicit native title attribute'

    const focusLink = document.createElement('a')
    focusLink.id = 'trunc-focus'
    focusLink.href = '#truncated'
    focusLink.style.cssText = 'display: block; width: 120px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 14px;'
    focusLink.textContent = 'Focusable link whose text overflows horizontally'

    host.append(single, clamp, notTrunc, explicit, focusLink)
    document.body.append(host)
  })

  const single = page.locator('#trunc-single')
  const clamp = page.locator('#trunc-clamp')
  const notTrunc = page.locator('#trunc-fit')
  const explicit = page.locator('#trunc-native')
  const focusLink = page.locator('#trunc-focus')

  await single.hover()
  await expect(single).toHaveAttribute('title', 'Extremely Long Channel Name That Gets Cut Off On Narrow Sidebars')
  await expect(single).toHaveAttribute('data-auto-title', '1')

  // Moving to a non-truncated element cleans up the temporary title and adds nothing to fitting text.
  await notTrunc.hover()
  await expect(single).not.toHaveAttribute('title')
  await expect(single).not.toHaveAttribute('data-auto-title')
  await expect(notTrunc).not.toHaveAttribute('title')

  // Multi-line clamped boxes also reveal full text on hover.
  await clamp.hover()
  await expect(clamp).toHaveAttribute(
    'title',
    'First sentence is visible and continues onto the second line and then overflows past line three and line four.',
  )
  await expect(clamp).toHaveAttribute('data-auto-title', '1')

  // Native non-auto title is never overwritten or removed on leave.
  await explicit.hover()
  await expect(explicit).toHaveAttribute('title', 'Existing native tooltip')
  await expect(explicit).not.toHaveAttribute('data-auto-title')
  await notTrunc.hover()
  await expect(explicit).toHaveAttribute('title', 'Existing native tooltip')

  // Keyboard focus triggers tooltip and cleans up when focus leaves.
  await focusLink.focus()
  await expect(focusLink).toHaveAttribute('title', 'Focusable link whose text overflows horizontally')
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur() })
  await notTrunc.hover()
  await expect(focusLink).not.toHaveAttribute('title')
})
