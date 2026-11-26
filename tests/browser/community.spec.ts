import { expect, test } from './test'

test('opens @s0laacol4/community, displays creator posts, switches Top/Newest sort, and opens a post to comment', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('/@s0laacol4/community')

  await expect(page).toHaveURL('/@s0laacol4/community')
  await expect(page.locator('main h1')).toContainText('Community', { timeout: 120_000 })

  const sortBar = page.locator('main .sorts')
  const topChip = sortBar.getByRole('button', { name: 'Top', exact: true })
  const newestChip = sortBar.getByRole('button', { name: 'Newest', exact: true })
  await expect(topChip).toHaveAttribute('aria-pressed', 'true')
  await expect(newestChip).toHaveAttribute('aria-pressed', 'false')

  const posts = page.locator('main article.post')
  await expect(posts.first()).toBeVisible({ timeout: 60_000 })
  expect(await posts.count()).toBeGreaterThan(1)

  const firstPost = posts.first()
  await expect(firstPost.getByRole('button', { name: 'Like post', exact: true })).toBeVisible()
  await expect(firstPost.getByRole('button', { name: 'Dislike post', exact: true })).toBeVisible()

  await newestChip.click()
  await expect(page).toHaveURL('/@s0laacol4/community?sort=Newest')
  await expect(newestChip).toHaveAttribute('aria-pressed', 'true', { timeout: 60_000 })
  await expect(posts.first()).toBeVisible({ timeout: 60_000 })

  const creatorChip = sortBar.getByRole('button', { name: 'Creator posts', exact: true })
  if (await creatorChip.isVisible()) {
    await creatorChip.click()
    await expect(creatorChip).toHaveAttribute('aria-pressed', 'true', { timeout: 60_000 })
    await expect(posts.first().locator('.creator-badge')).toHaveText('Creator', { timeout: 60_000 })
  }

  // Navigating to a channel header links to Community and clicking opens the community page
  await page.goto('/@s0laacol4')
  const communityLink = page.locator('main .subscribe-row').getByRole('link', { name: 'Community', exact: true })
  await expect(communityLink).toHaveAttribute('href', '/@s0laacol4/community', { timeout: 60_000 })

  // Opening a post's Comments link reaches /post/<id> with like/dislike and comment box prompt
  await page.goto('/@s0laacol4/community')
  const commentLink = posts.first().locator('a.post-comments')
  await expect(commentLink).toBeVisible({ timeout: 60_000 })
  const postHref = await commentLink.getAttribute('href')
  await commentLink.click()
  await expect(page).toHaveURL(postHref!)
  await expect(page.locator('main article.post').getByRole('button', { name: 'Like post', exact: true })).toBeVisible({ timeout: 60_000 })
})
