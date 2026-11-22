import { expect, test } from './test'

test('renders clickable description links, READ MORE, duration badge, and hover preview on @MKBHD featured video', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/@MKBHD')

  const featured = page.getByRole('region', { name: 'Featured video' })
  const titleLink = featured.locator('h2.featured-title a')
  await expect(titleLink).toBeVisible({ timeout: 120_000 })
  const watchHref = await titleLink.getAttribute('href')
  expect(watchHref).toMatch(/^\/watch\?v=[\w-]{11}$/)

  const description = featured.locator('.featured-description')
  await expect(description).toBeVisible()
  const links = description.locator('a')
  expect(await links.count()).toBeGreaterThan(0)
  const hrefs = await links.evaluateAll((anchors) => anchors.map((anchor) => ({
    href: anchor.getAttribute('href'),
    target: anchor.getAttribute('target'),
    rel: anchor.getAttribute('rel'),
  })))
  for (const link of hrefs) {
    expect(link.href).toBeTruthy()
    expect(link.href).not.toContain('youtube.com/redirect')
    if (link.href!.startsWith('http')) {
      expect(link.target).toBe('_blank')
      expect(link.rel).toBe('noreferrer noopener')
    }
  }

  // Clipped cleanly by max-height rather than -webkit-line-clamp so a blank paragraph line never gets a lone ellipsis
  const clampStyle = await description.evaluate((element) => {
    const computed = getComputedStyle(element)
    return {
      lineClamp: computed.webkitLineClamp,
      overflowY: computed.overflowY,
      height: Math.round(element.getBoundingClientRect().height),
    }
  })
  expect(clampStyle.lineClamp).toBe('none')
  expect(clampStyle.overflowY).toBe('hidden')
  expect(clampStyle.height).toBeLessThanOrEqual(122)
  const textLines = (await description.innerText()).split('\n').map((line) => line.trim())
  expect(textLines).not.toContain('...')
  expect(textLines).not.toContain('…')

  const readMore = featured.getByRole('link', { name: 'READ MORE', exact: true })
  await expect(readMore).toBeVisible()
  await expect(readMore).toHaveAttribute('href', watchHref!)

  const thumb = featured.locator('a.featured-thumb')
  expect(await thumb.evaluate((element) => getComputedStyle(element).position)).toBe('relative')
  await expect(thumb.locator('.badge')).toHaveText(/^\d+(:\d{2}){1,2}$/)

  // Hovering the featured thumbnail mounts the inline HoverPreview player and moving onto the text unmounts it
  await expect(thumb.locator('video')).toHaveCount(0)
  await thumb.hover()
  await expect(thumb.locator('video')).toHaveCount(1)
  await titleLink.hover()
  await expect(thumb.locator('video')).toHaveCount(0)
})
