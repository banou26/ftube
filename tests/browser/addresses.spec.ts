import { expect, test } from './test'

/* youtube.com answers each of these addresses with a page of its own, checked headless on 2026-11-10. This client keeps
   most of those pages under another route, so the address either bounces there or opens the same page in place. */

test('opens a live stream\'s Share link, /live/<id>, on its watch page', async ({ page }) => {
  await page.goto('/live/rFZHOHl-L8A?si=shared&t=30')
  await expect(page).toHaveURL('/watch?v=rFZHOHl-L8A&t=30')
})

test('opens an embed address, /embed/<id>, on the watch page at its start', async ({ page }) => {
  await page.goto('/embed/dQw4w9WgXcQ?start=42')
  await expect(page).toHaveURL('/watch?v=dQw4w9WgXcQ&t=42')
})

test('opens a playlist\'s embed on the playlist, and an embed inside a playlist on the watch page in it', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/embed/videoseries?list=PLBsP89CPrMeNIuvr9j3_EQaMwaNJ6rhuQ')
  await expect(page).toHaveURL('/playlist?list=PLBsP89CPrMeNIuvr9j3_EQaMwaNJ6rhuQ')
  await expect(page.locator('main h1')).toHaveText('Retro Tech S2', { timeout: 120_000 })

  await page.goto('/embed/MhKiMPiZOdE?list=PLBsP89CPrMeNIuvr9j3_EQaMwaNJ6rhuQ&start=30')
  await expect(page).toHaveURL('/watch?v=MhKiMPiZOdE&list=PLBsP89CPrMeNIuvr9j3_EQaMwaNJ6rhuQ&t=30')
})

test('preserves playlist index and start position across /embed, /watch/:id, and /live/:id redirects (APP-1106)', async ({ page }) => {
  await page.route('https://*.sdbx.app/**', () => {})
  await page.route('https://www.youtube.com/**', () => {})
  await page.route('**/__yt_engine__/**', () => {})

  for (const viewport of [{ width: 1280, height: 800 }, { width: 412, height: 915 }]) {
    await page.setViewportSize(viewport)
    await page.goto('/embed/hMbNlxJhR7k?list=PL2aBZuCeDwlQvNtHhNJtarm9OewQwVntv&index=5&start=30', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL('/watch?v=hMbNlxJhR7k&list=PL2aBZuCeDwlQvNtHhNJtarm9OewQwVntv&index=5&t=30')
  }

  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/watch/hMbNlxJhR7k?list=PL2aBZuCeDwlQvNtHhNJtarm9OewQwVntv&index=5&t=30', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL('/watch?v=hMbNlxJhR7k&list=PL2aBZuCeDwlQvNtHhNJtarm9OewQwVntv&index=5&t=30')

  await page.goto('/live/hMbNlxJhR7k?list=PL2aBZuCeDwlQvNtHhNJtarm9OewQwVntv&index=5&t=30&si=shared', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL('/watch?v=hMbNlxJhR7k&list=PL2aBZuCeDwlQvNtHhNJtarm9OewQwVntv&index=5&t=30')
})

test('opens /c/<name> on the channel, and its tabs under the channel\'s handle', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/c/mkbhd')
  await expect(page.locator('main h1')).toHaveText('Marques Brownlee', { timeout: 120_000 })
  await expect(page).toHaveURL('/c/mkbhd')
  await page.getByRole('navigation', { name: 'Channel sections' }).getByRole('link', { name: 'Videos', exact: true }).click()
  await expect(page).toHaveURL('/@mkbhd/videos')
  await expect(page.locator('main article a[href^="/watch?v="]').first()).toBeVisible({ timeout: 120_000 })
})

test('opens /user/<name> on the channel, and /user/<name>/<tab> on that tab', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/user/marquesbrownlee/videos')
  await expect(page.locator('main h1')).toHaveText('Marques Brownlee', { timeout: 120_000 })
  await expect(page).toHaveURL('/user/marquesbrownlee/videos')
  const tabs = page.getByRole('navigation', { name: 'Channel sections' })
  await expect(tabs.getByRole('link', { name: 'Videos', exact: true })).toHaveAttribute('aria-current', 'page')
})

test('opens /gaming on the Gaming topic channel', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/gaming')
  await expect(page).toHaveURL('/channel/UCOpNcN46UbXVtpKMrmU4Abg')
  await expect(page.locator('main h1')).toHaveText('Gaming', { timeout: 120_000 })
})

test('opens /hashtag/<tag> on the hashtag page and navigates to its Shorts tab', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/hashtag/ASMR')
  await expect(page).toHaveURL('/hashtag/asmr')
  await expect(page.locator('main h1')).toHaveText('#asmr', { timeout: 120_000 })
  await expect(page.locator('main article a[href^="/watch?v="]').first()).toBeVisible({ timeout: 120_000 })

  await page.getByRole('navigation', { name: 'Hashtag sections' }).getByRole('link', { name: 'Shorts', exact: true }).click()
  await expect(page).toHaveURL('/hashtag/asmr/shorts')
  await expect(page.locator('main a[href^="/shorts/"]').first()).toBeVisible({ timeout: 120_000 })
})

test('links description hashtags to /hashtag/<tag> instead of /channel/FEhashtag or search', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/watch?v=dQw4w9WgXcQ')
  const description = page.locator('.about')
  await expect(description).toBeVisible({ timeout: 120_000 })
  const expand = description.getByRole('button', { name: '...more' })
  if (await expand.isVisible().catch(() => false)) await expand.click()
  const hashtagLink = description.locator('a[href^="/hashtag/"]').first()
  await expect(hashtagLink).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('a[href="/channel/FEhashtag"]')).toHaveCount(0)
  await expect(description.locator('a[href^="/results?search_query=%23"]')).toHaveCount(0)
  const expectedTag = (await hashtagLink.innerText()).trim().toLowerCase()
  const expectedSlug = expectedTag.replace(/^#/, '')
  await hashtagLink.click()
  await expect(page).toHaveURL(new RegExp(`/hashtag/${expectedSlug}$`))
  await expect(page.locator('main h1')).toHaveText(expectedTag, { timeout: 120_000 })
  await expect(page.locator('main article a[href^="/watch?v="]').first()).toBeVisible({ timeout: 120_000 })
})

test('opens /post/<id> on the post, and says when there is none', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/post/UgkxX6gkDxQ0KRucvyG7NLui0LhjHp0CLlfZ')
  const post = page.locator('main article.post')
  await expect(post).toContainText('Welcome to the Blind Smartphone Camera Test 2023!', { timeout: 120_000 })
  await expect(post.getByRole('link', { name: 'Marques Brownlee' })).toHaveAttribute('href', '/channel/UCBJycsmduvYEL83R_U4JriQ')

  await page.goto('/post/UgkxNOPENOPENOPENOPENOPENOPENOPENOPE1')
  await expect(page.locator('main .status')).toHaveText('This post isn\'t available.', { timeout: 120_000 })
})
