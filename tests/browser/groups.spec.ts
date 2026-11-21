import { expect, test } from './test'

/* Signed out. Groups live in this profile's localStorage, so each test starts with none. The guide only lists
   groups when it is expanded, which needs a viewport wider than 1312px. */

test.use({ viewport: { width: 1440, height: 900 } })

const BLENDER = 'UCSMOQeBJ2RAnuFungnQOxLg'

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

  await page.getByRole('button', { name: 'Groups', exact: true }).click()
  await expect(page.getByRole('menuitemcheckbox', { name: '3D' })).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')

  const guide = page.getByRole('navigation', { name: 'Guide' })
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
  await expect(page.getByRole('navigation', { name: 'Guide' }).getByRole('link', { name: 'Songs' })).toBeVisible()

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
