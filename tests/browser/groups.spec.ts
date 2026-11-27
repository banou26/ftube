import { expect, test } from './test'

/* Signed out. Groups live in this profile's localStorage, so each test starts with none. The guide only lists
   groups when it is expanded, which needs a viewport wider than 1312px. */

test.use({ viewport: { width: 1440, height: 900 } })

const BLENDER = 'UCSMOQeBJ2RAnuFungnQOxLg'

test('suggests creating a matching new group and adding to an existing matching group on top of the Groups menu', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto(`/channel/${BLENDER}`)
  await expect(page.locator('h1')).toHaveText('Blender', { timeout: 90_000 })

  await page.getByRole('button', { name: 'Groups', exact: true }).click()
  const suggestedGroup = page.getByRole('group', { name: 'Suggested' })
  await expect(suggestedGroup).toBeVisible()
  const suggestedItem = suggestedGroup.getByRole('menuitem', { name: 'Create 3D' })
  await expect(suggestedItem).toContainText('Create')
  await suggestedItem.click()

  const dialog = page.getByRole('dialog', { name: 'New group' })
  await expect(dialog.getByLabel('Name')).toHaveValue('3D')
  await expect(dialog.getByRole('radio', { name: '🎨' })).toHaveAttribute('aria-checked', 'true')
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByText('Added to 3D')).toBeVisible()

  await page.locator('main').getByRole('button', { name: 'Groups', exact: true }).click()
  await expect(page.getByRole('menuitemcheckbox', { name: '3D' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('group', { name: 'Suggested' })).toHaveCount(0)
  await page.keyboard.press('Escape')

  // When an existing matching group does not yet contain a channel, the top Suggested section offers one-click add
  await page.evaluate(() => {
    localStorage.setItem('yt-client:groups', JSON.stringify([{
      id: 'g-music',
      name: 'Music',
      emoji: '🎵',
      channels: [],
      updatedAt: Date.now(),
    }]))
  })
  await page.goto('/feed/channels')
  await expect(async () => {
    const host = page.locator('[data-channels-harness]')
    if (await host.count() === 0) {
      await page.evaluate(async (path) => {
        const harness = await import(path) as typeof import('./fixtures/menu-data-harness')
        harness.mountChannelsSurface()
      }, '/tests/browser/fixtures/menu-data-harness.tsx')
    }
    await expect(host).toBeAttached({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })
  const harness = page.locator('[data-channels-harness]')
  const betaRow = harness.locator('.list .row', { hasText: 'Beta Music' })
  await betaRow.getByRole('button', { name: 'Groups', exact: true }).click()
  const existingSuggested = page.getByRole('group', { name: 'Suggested' }).getByRole('menuitem', { name: 'Add to Music' })
  await expect(existingSuggested).toBeVisible()
  await existingSuggested.click()
  await expect(page.getByText('Added to Music')).toBeVisible()
})

test('makes a group from a channel page and shows its uploads', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto(`/channel/${BLENDER}`)
  await expect(page.locator('h1')).toHaveText('Blender', { timeout: 90_000 })

  await page.getByRole('button', { name: 'Groups', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New group' }).click()
  const dialog = page.getByRole('dialog', { name: 'New group' })
  await expect(dialog.getByText('Blender', { exact: true })).toBeVisible()
  await dialog.getByLabel('Name').fill('3D')
  await dialog.getByRole('radio', { name: '🎨' }).click()
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByText('Added to 3D')).toBeVisible()

  await page.locator('main').getByRole('button', { name: 'Groups', exact: true }).click()
  await expect(page.getByRole('menuitemcheckbox', { name: '3D' })).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')

  const guide = page.getByRole('navigation', { name: 'Guide' })
  await guide.getByRole('button', { name: 'Groups', exact: true }).click()
  await guide.getByRole('link', { name: '3D' }).click()
  await expect(page).toHaveURL(/\/feed\/groups\/[\w-]+$/)
  await expect(page.locator('h1')).toHaveText('3D')
  await expect(page.getByText('1 channel', { exact: true })).toBeVisible()
  const cards = page.locator('main article')
  await expect(cards.first().locator('a[href^="/watch?v="]').first()).toBeVisible({ timeout: 90_000 })
  await expect(cards.first().locator('.thumb .badge')).toHaveText(/^\d+:\d{2}(:\d{2})?$/)
  await expect(cards.first().getByRole('link', { name: 'Blender' }).first()).toBeVisible()
  await expect(cards.first()).toContainText(/\d+ (second|minute|hour|day|week|month|year)s? ago/)
  expect(await cards.count()).toBeGreaterThanOrEqual(5)
})

test('creates, renames and deletes a group from the manager, and keeps it across a reload', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/feed/groups')
  const main = page.locator('main')
  await expect(main.getByText('No groups yet')).toBeVisible({ timeout: 30_000 })

  await main.getByRole('button', { name: 'New group' }).click()
  const created = page.getByRole('dialog', { name: 'New group' })
  await expect(created.getByRole('button', { name: 'Create' })).toBeDisabled()
  await created.getByLabel('Name').fill('Songs')
  await created.getByRole('radio', { name: '🎵' }).click()
  await created.getByRole('button', { name: 'Create' }).click()
  await expect(main.getByRole('link', { name: /Songs/ })).toContainText('0 channels')
  const guide = page.getByRole('navigation', { name: 'Guide' })
  await guide.getByRole('button', { name: 'Groups', exact: true }).click()
  await expect(guide.getByRole('link', { name: 'Songs' })).toBeVisible()

  await main.getByRole('button', { name: 'Edit Songs' }).click()
  const edited = page.getByRole('dialog', { name: 'Edit group' })
  await edited.getByLabel('Name').fill('Tunes')
  await edited.getByRole('button', { name: 'Save' }).click()
  await expect(main.getByRole('link', { name: /Tunes/ })).toBeVisible()
  await expect(main.getByRole('link', { name: /Songs/ })).toHaveCount(0)

  await page.reload()
  await expect(main.getByRole('link', { name: /Tunes/ })).toBeVisible({ timeout: 30_000 })
  await expect(main.getByRole('link', { name: /Tunes/ })).toContainText('🎵')

  await main.getByRole('button', { name: 'Delete Tunes' }).click()
  const confirm = page.getByRole('dialog', { name: 'Delete Tunes?' })
  await confirm.getByRole('button', { name: 'Delete' }).click()
  await expect(main.getByText('No groups yet')).toBeVisible()

  await page.reload()
  await expect(main.getByText('No groups yet')).toBeVisible({ timeout: 30_000 })
})

test('group edit selects all filtered channels, previews a channel on hover and navigates on click', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/privacy')
  await expect(async () => {
    const host = page.locator('[data-group-picker-harness]')
    if (await host.count() === 0) {
      await page.evaluate(async (path) => {
        const harness = await import(path) as typeof import('./fixtures/menu-data-harness')
        harness.mountGroupPicker()
      }, '/tests/browser/fixtures/menu-data-harness.tsx')
    }
    await expect(host).toBeAttached({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })

  const dialog = page.getByRole('dialog', { name: 'New group' })
  await expect(dialog.getByRole('checkbox', { name: 'Alpha Tech' })).toBeVisible()

  // pre-select Gamma Music outside the filter, then filter to Tech and select all filtered
  await dialog.getByRole('checkbox', { name: 'Gamma Music' }).check()
  await dialog.getByRole('searchbox', { name: 'Filter subscriptions' }).fill('tech')
  const selectAll = dialog.getByRole('checkbox', { name: 'Select all (2)' })
  await expect(selectAll).not.toBeChecked()
  await selectAll.check()
  await expect(dialog.getByRole('checkbox', { name: 'Alpha Tech' })).toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: 'Beta Tech' })).toBeChecked()
  // unchecking one filtered channel makes Select all indeterminate
  await dialog.getByRole('checkbox', { name: 'Beta Tech' }).uncheck()
  await expect.poll(() => selectAll.evaluate((el) => (el as HTMLInputElement).indeterminate)).toBe(true)
  // checking Select all selects both again, and unchecking clears only filtered channels (Gamma Music stays)
  await selectAll.check()
  await expect(dialog.getByRole('checkbox', { name: 'Beta Tech' })).toBeChecked()
  await selectAll.uncheck()
  await expect(dialog.getByRole('checkbox', { name: 'Alpha Tech' })).not.toBeChecked()
  await expect(dialog.getByRole('button', { name: 'Remove Gamma Music' })).toBeVisible()

  // hovering a channel shows its page preview card with stats and latest video
  const alphaLink = dialog.getByRole('link', { name: 'Alpha Tech' })
  await alphaLink.hover()
  const preview = page.locator('[data-channel-preview="UCaaaaaaaaaaaaaaaaaaaaaa"]')
  await expect(preview).toBeVisible({ timeout: 10_000 })
  await expect(preview).toContainText('120K subscribers')
  await expect(preview).toContainText('Alpha Tech latest video')
  await expect(preview).toContainText('5:25')

  // clicking a channel goes to its channel page and closes the dialog
  await alphaLink.click()
  await expect(page).toHaveURL('/channel/UCaaaaaaaaaaaaaaaaaaaaaa')
  await expect(dialog).toHaveCount(0)
})

test('nests subfolders, collapses in the guide, rolls up child uploads on the parent, and promotes on delete', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('/feed/groups')
  const main = page.locator('main')
  await expect(main.getByText('No groups yet')).toBeVisible({ timeout: 30_000 })

  // create parent folder
  await main.getByRole('button', { name: 'New group' }).click()
  const parentDialog = page.getByRole('dialog', { name: 'New group' })
  await parentDialog.getByLabel('Name').fill('Graphics')
  await parentDialog.getByRole('button', { name: 'Create' }).click()
  await expect(main.getByRole('link', { name: /Graphics/ })).toBeVisible()

  // create subfolder inside Graphics from the row action
  await main.getByRole('button', { name: 'New subfolder in Graphics' }).click()
  const childDialog = page.getByRole('dialog', { name: 'New group' })
  await expect(childDialog.getByLabel('Parent folder')).not.toHaveValue('')
  await childDialog.getByLabel('Name').fill('Blender3D')
  await childDialog.getByRole('button', { name: 'Create' }).click()

  await expect(main.locator('li[data-depth="1"]').getByRole('link', { name: /Blender3D/ })).toBeVisible()
  await expect(main.getByRole('link', { name: /Graphics/ })).toContainText('1 subfolder')

  // guide shows nested row and collapses/expands child folder
  const guide = page.getByRole('navigation', { name: 'Guide' })
  await guide.getByRole('button', { name: 'Groups', exact: true }).click()
  await expect(guide.locator('[data-depth="1"]').getByRole('link', { name: 'Blender3D' })).toBeVisible()
  await guide.getByRole('button', { name: 'Collapse Graphics' }).click()
  await expect(guide.getByRole('link', { name: 'Blender3D' })).toHaveCount(0)
  await guide.getByRole('button', { name: 'Expand Graphics' }).click()
  await expect(guide.getByRole('link', { name: 'Blender3D' })).toBeVisible()

  // add Blender channel to the subfolder from the channel page
  await page.goto(`/channel/${BLENDER}`)
  await expect(page.locator('h1')).toHaveText('Blender', { timeout: 90_000 })
  await page.locator('main').getByRole('button', { name: 'Groups', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Blender3D' }).click()
  await expect(page.getByText('Added to Blender3D')).toBeVisible()
  await page.keyboard.press('Escape')

  // parent folder shows subfolder chip and aggregates child channel uploads
  await guide.getByRole('button', { name: 'Groups', exact: true }).click()
  await guide.getByRole('link', { name: 'Graphics' }).click()
  await expect(page.locator('h1')).toHaveText('Graphics')
  await expect(page.getByText('1 channel • 1 subfolder')).toBeVisible()
  await expect(main.locator('.subgroups').getByRole('link', { name: /Blender3D/ })).toBeVisible()
  await expect(main.locator('article').first().locator('a[href^="/watch?v="]').first()).toBeVisible({ timeout: 90_000 })

  // clicking subfolder chip shows parent breadcrumb
  await main.locator('.subgroups').getByRole('link', { name: /Blender3D/ }).click()
  await expect(page.locator('h1')).toHaveText('Blender3D')
  await expect(main.getByRole('navigation', { name: 'Parent folders' }).getByRole('link', { name: /Graphics/ })).toBeVisible()

  // deleting parent promotes subfolder back to top level
  await page.goto('/feed/groups')
  await main.getByRole('button', { name: 'Delete Graphics' }).click()
  const confirm = page.getByRole('dialog', { name: 'Delete Graphics?' })
  await expect(confirm.getByText('Subfolders will move up one level.')).toBeVisible()
  await confirm.getByRole('button', { name: 'Delete' }).click()
  await expect(main.locator('li[data-depth="0"]').getByRole('link', { name: /Blender3D/ })).toBeVisible()
})

test('shows group suggestions on channel pages with null tags, on watch pages, and on search channel cards', async ({ page }) => {
  test.setTimeout(180_000)

  await page.goto(`/channel/${BLENDER}`)
  await expect(async () => {
    const host = page.locator('[data-channel-header-harness="tags-fallback"]')
    if (await host.count() === 0) {
      await page.evaluate(async (path) => {
        const harness = await import(path) as typeof import('./fixtures/menu-data-harness')
        harness.mountChannelHeader('tags-fallback')
      }, '/tests/browser/fixtures/menu-data-harness.tsx')
    }
    await expect(host).toBeAttached({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })

  const channelHost = page.locator('[data-channel-header-harness="tags-fallback"]')
  await expect(channelHost.locator('h1')).toHaveText('Quiet Creator')
  await channelHost.getByRole('button', { name: 'Groups', exact: true }).click()
  await expect(page.getByRole('group', { name: 'Suggested' }).getByRole('menuitem', { name: 'Create ASMR' })).toBeVisible()
  await page.keyboard.press('Escape')

  await page.goto('/watch?v=dQw4w9WgXcQ')
  const watchMoreActions = page.locator('main').getByRole('button', { name: 'More actions', exact: true })
  await expect(watchMoreActions).toBeVisible({ timeout: 90_000 })
  await watchMoreActions.click()
  await page.getByRole('menu', { name: 'More actions' }).getByRole('menuitem', { name: 'Groups', exact: true }).click()
  const groupsDialog = page.getByRole('dialog', { name: 'Groups' })
  await expect(groupsDialog).toBeVisible()
  await expect(groupsDialog.getByRole('button', { name: 'Create Music', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')

  await page.goto('/results?search_query=Blender')
  const searchGroups = page.locator('main').getByRole('button', { name: 'Groups', exact: true }).first()
  await expect(searchGroups).toBeVisible({ timeout: 90_000 })
  await searchGroups.click()
  await expect(page.getByRole('group', { name: 'Suggested' }).getByRole('menuitem', { name: 'Create 3D' })).toBeVisible()
})

test('shows multiple suggestions including top 3 relevant tags in Groups menu and lets the user create one', async ({ page }) => {
  test.setTimeout(120_000)
  await page.addInitScript(() => {
    localStorage.setItem('yt-client:groups', JSON.stringify([{
      id: 'g-tech',
      name: 'Tech',
      emoji: '💻',
      channels: [],
      updatedAt: Date.now(),
    }]))
  })
  await page.goto('/feed/channels')
  await expect(async () => {
    const host = page.locator('[data-channels-harness]')
    if (await host.count() === 0) {
      await page.evaluate(async (path) => {
        const harness = await import(path) as typeof import('./fixtures/menu-data-harness')
        harness.mountChannelsSurface({ withLinux: true })
      }, '/tests/browser/fixtures/menu-data-harness.tsx')
    }
    await expect(host).toBeAttached({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })

  const harness = page.locator('[data-channels-harness]')
  const linuxRow = harness.locator('.list .row', { hasText: 'The Linux Experiment' })
  await linuxRow.getByRole('button', { name: 'Groups', exact: true }).click()

  const suggested = page.getByRole('group', { name: 'Suggested' })
  await expect(suggested).toBeVisible()
  await expect(suggested.getByRole('menuitem', { name: 'Add to Tech', exact: true })).toBeVisible()
  await expect(suggested.getByRole('menuitem', { name: 'Create Linux', exact: true })).toBeVisible()
  await expect(suggested.getByRole('menuitem', { name: 'Create Linux Desktop', exact: true })).toBeVisible()
  await expect(suggested.getByRole('menuitem', { name: 'Create Linux News', exact: true })).toBeVisible()
  await expect(suggested.getByRole('menuitem', { name: 'Create Linux 2025' })).toHaveCount(0)
  await expect(suggested.getByRole('menuitem', { name: 'Create Best Linux' })).toHaveCount(0)
  await expect(suggested.getByRole('menuitem', { name: 'Create Linux Videos' })).toHaveCount(0)
  await expect(suggested.getByRole('menuitem', { name: 'Create Switching To Linux' })).toHaveCount(0)

  await suggested.getByRole('menuitem', { name: 'Create Linux', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New group' })
  await expect(dialog.getByLabel('Name')).toHaveValue('Linux')
  await expect(dialog.getByRole('radio', { name: '💻' })).toHaveAttribute('aria-checked', 'true')
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByText('Added to Linux')).toBeVisible()
})
