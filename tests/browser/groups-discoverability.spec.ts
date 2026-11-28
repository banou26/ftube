import type { Page } from '@playwright/test'
import type { GroupsHarnessOptions } from './fixtures/groups-discoverability-harness'

import { expect, test } from './test'

const HARNESS = '/tests/browser/fixtures/groups-discoverability-harness.tsx'
const NASA_ID = 'UCLA_DiR1FfKNvjuUpBHmylQ'

const mountHarness = async (page: Page, options: GroupsHarnessOptions) => {
  await page.route('https://*.sdbx.app/**', route => route.abort())
  await page.route('https://www.youtube.com/**', route => route.abort())
  await page.route('**/__yt_engine__/**', route => route.abort())
  await page.goto('/privacy')
  await expect(async () => {
    const host = page.locator('[data-groups-discoverability-harness="true"]')
    if (await host.count() === 0) {
      await page.evaluate(async ([path, opts]) => {
        const harness = await import(path!) as typeof import('./fixtures/groups-discoverability-harness')
        harness.mountGroupsDiscoverabilityHarness(opts)
      }, [HARNESS, options] as const)
    }
    await expect(host).toBeAttached({ timeout: 5_000 })
  }).toPass({ timeout: 30_000 })
}

test('guides empty group creation and first-channel assignment for guests (APP-1065)', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', err => pageErrors.push(err.message))

  await mountHarness(page, { signedIn: false, initialPath: '/feed/groups' })
  const harness = page.locator('[data-groups-discoverability-harness="true"]')

  await harness.getByRole('button', { name: 'New group', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New group' })
  await expect(dialog.getByText('No channels yet. Create empty, then use Add to group on any channel page.')).toBeVisible()
  await expect(dialog.getByText('Sign in to pick from subscriptions.')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()

  await dialog.getByLabel('Name').fill('Space Watch')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()

  await harness.getByRole('link', { name: /Space Watch/ }).click()
  await expect(harness.getByText('No channels in this group yet. Use Add to group on any channel page.')).toBeVisible()
  await expect(harness.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()

  const browseHome = harness.getByRole('link', { name: 'Browse home', exact: true })
  await expect(browseHome).toBeVisible()
  await expect(browseHome).toHaveCSS('text-decoration-line', 'none')
  await browseHome.click()
  await expect(harness.getByRole('heading', { name: 'Browse Home' })).toBeVisible()
  await harness.getByRole('link', { name: 'NASA', exact: true }).click()

  await harness.getByRole('button', { name: 'Add to group', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Space Watch' }).click()
  await page.keyboard.press('Escape')

  await harness.getByRole('link', { name: 'All groups', exact: true }).click()
  await harness.getByRole('link', { name: /Space Watch/ }).click()
  await expect(harness.getByText('1 channel', { exact: true })).toBeVisible()
  await expect(harness.getByText('NASA launch coverage')).toBeVisible()

  expect(pageErrors).toEqual([])
})

test('guides signed-in viewers from New group and empty group feed to subscription picking (APP-1065)', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', err => pageErrors.push(err.message))

  // First check signed-in viewer with zero subscriptions.
  await mountHarness(page, { signedIn: true, initialPath: '/feed/groups', subscriptions: [] })
  const harness = page.locator('[data-groups-discoverability-harness="true"]')
  await harness.getByRole('button', { name: 'New group', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: 'New group' })
  await expect(dialog.getByText('No channels yet. Use Add to group on any channel page.')).toBeVisible()
  await expect(dialog.getByText('No subscriptions yet.')).toBeVisible()
  await expect(dialog.getByRole('searchbox', { name: 'Filter subscriptions' })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()

  // Now test signed-in viewer with subscriptions creating an empty group, then picking from subscriptions.
  await mountHarness(page, { signedIn: true, initialPath: '/feed/groups' })
  await harness.getByRole('button', { name: 'New group', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'New group' })
  await expect(dialog.getByRole('checkbox', { name: 'Alpha Tech' })).toBeVisible()

  await dialog.getByLabel('Name').fill('Empty Picks')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()

  await harness.getByRole('link', { name: /Empty Picks/ }).click()
  await expect(harness.getByText('No channels in this group yet. Use Add to group on any channel page.')).toBeVisible()
  await expect(harness.getByRole('link', { name: 'Browse channels', exact: true })).toHaveAttribute('href', '/feed/channels')
  await harness.getByRole('button', { name: 'Pick from subscriptions', exact: true }).click()

  const editDialog = page.getByRole('dialog', { name: 'Edit group' })
  await editDialog.getByRole('checkbox', { name: 'Alpha Tech' }).check()
  await editDialog.getByRole('button', { name: 'Save', exact: true }).click()

  await expect(harness.getByText('1 channel', { exact: true })).toBeVisible()
  await expect(harness.getByText('Alpha Tech build log')).toBeVisible()

  expect(pageErrors).toEqual([])
})

test('shows guest action prompt on channel page and updates trigger label after creation (APP-1052)', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', err => pageErrors.push(err.message))

  await mountHarness(page, { signedIn: false, initialPath: `/channel/${NASA_ID}` })
  const harness = page.locator('[data-groups-discoverability-harness="true"]')

  const addButton = harness.getByRole('button', { name: 'Add to group', exact: true })
  await expect(addButton).toBeVisible()
  await addButton.click()

  await expect(page.getByText('Create a group to add this channel.')).toBeVisible()
  await page.getByRole('menuitem', { name: 'New group', exact: true }).click()

  const dialog = page.getByRole('dialog', { name: 'New group' })
  await dialog.getByLabel('Name').fill('Space')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()

  await expect(harness.getByText('Added to Space')).toBeVisible()
  const editButton = harness.getByRole('button', { name: 'Edit groups', exact: true })
  await expect(editButton).toBeVisible()

  await editButton.click()
  await expect(page.getByRole('menuitemcheckbox', { name: 'Space', exact: true })).toHaveAttribute('aria-checked', 'true')

  expect(pageErrors).toEqual([])
})

test('shows searchable nested folder paths for unsubscribed channels and persists membership (APP-1052)', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', err => pageErrors.push(err.message))

  await page.addInitScript(() => {
    if (window.top !== window) return
    localStorage.setItem('yt-client:groups', JSON.stringify([
      { id: 'g-science', name: 'Science', emoji: '🔬', channels: [], updatedAt: 1 },
      { id: 'g-space', name: 'Space', emoji: '🚀', parentId: 'g-science', channels: [], updatedAt: 2 },
      { id: 'g-nasa', name: 'NASA Missions', emoji: '🛰️', parentId: 'g-space', channels: [], updatedAt: 3 },
      { id: 'g-music', name: 'Music', emoji: '🎵', channels: [], updatedAt: 4 },
    ]))
  })

  await mountHarness(page, { signedIn: true, initialPath: `/channel/${NASA_ID}` })
  const harness = page.locator('[data-groups-discoverability-harness="true"]')

  await expect(harness.getByRole('button', { name: 'Subscribe', exact: true })).toBeVisible()
  await harness.getByRole('button', { name: 'Add to group', exact: true }).click()

  await expect(page.getByRole('menuitemcheckbox', { name: 'Science / Space', exact: true })).toBeVisible()
  await expect(page.getByRole('menuitemcheckbox', { name: 'Science / Space / NASA Missions', exact: true })).toBeVisible()
  await expect(page.getByRole('menuitemcheckbox', { name: 'Science / Space / NASA Missions', exact: true })).toContainText('Science / Space')

  const filterInput = page.getByRole('searchbox', { name: 'Filter groups' })
  await filterInput.fill('Science / Space')
  await expect(page.getByRole('menuitemcheckbox', { name: 'Music', exact: true })).toHaveCount(0)
  await expect(page.getByRole('menuitemcheckbox', { name: 'Science', exact: true })).toHaveCount(0)

  const missionsItem = page.getByRole('menuitemcheckbox', { name: 'Science / Space / NASA Missions', exact: true })
  await expect(missionsItem).toBeVisible()
  await missionsItem.click()
  await expect(missionsItem).toHaveAttribute('aria-checked', 'true')
  await expect(harness.getByText('Added to NASA Missions')).toBeVisible()
  await page.keyboard.press('Escape')

  await expect(harness.getByRole('button', { name: 'Edit groups', exact: true })).toBeVisible()

  await harness.getByRole('link', { name: 'All groups', exact: true }).click()
  await harness.getByRole('link', { name: /NASA Missions/ }).click()
  await expect(harness.getByText('1 channel', { exact: true })).toBeVisible()
  await expect(harness.getByText('NASA launch coverage')).toBeVisible()

  await harness.getByRole('link', { name: 'Open NASA channel', exact: true }).click()
  await harness.getByRole('button', { name: 'Edit groups', exact: true }).click()
  await expect(page.getByRole('menuitemcheckbox', { name: 'Science / Space / NASA Missions', exact: true })).toHaveAttribute('aria-checked', 'true')

  expect(pageErrors).toEqual([])
})

test('supports keyboard-only filtering, toggling, and focus return in the Groups menu (APP-1052)', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', err => pageErrors.push(err.message))

  await page.addInitScript(() => {
    if (window.top !== window) return
    localStorage.setItem('yt-client:groups', JSON.stringify([
      { id: 'g-science', name: 'Science', emoji: '🔬', channels: [], updatedAt: 1 },
      { id: 'g-space', name: 'Space', emoji: '🚀', parentId: 'g-science', channels: [], updatedAt: 2 },
      { id: 'g-nasa', name: 'NASA Missions', emoji: '🛰️', parentId: 'g-space', channels: [], updatedAt: 3 },
      { id: 'g-music', name: 'Music', emoji: '🎵', channels: [], updatedAt: 4 },
    ]))
  })

  await mountHarness(page, { signedIn: true, initialPath: `/channel/${NASA_ID}` })
  const harness = page.locator('[data-groups-discoverability-harness="true"]')

  const addButton = harness.getByRole('button', { name: 'Add to group', exact: true })
  await addButton.focus()
  await page.keyboard.press('Enter')

  const filterInput = page.getByRole('searchbox', { name: 'Filter groups' })
  await expect(filterInput).toBeFocused()
  await page.keyboard.type('NASA Missions')
  await page.keyboard.press('ArrowDown')

  const missionsItem = page.getByRole('menuitemcheckbox', { name: 'Science / Space / NASA Missions', exact: true })
  await expect(missionsItem).toBeFocused()
  await page.keyboard.press('Space')
  await expect(missionsItem).toHaveAttribute('aria-checked', 'true')

  await page.keyboard.press('ArrowUp')
  await expect(filterInput).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(harness.getByRole('button', { name: 'Edit groups', exact: true })).toBeFocused()

  expect(pageErrors).toEqual([])
})
