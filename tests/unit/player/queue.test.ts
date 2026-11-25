import { beforeEach, describe, expect, it } from 'vite-plus/test'

import { appendQueueEntry, clearQueue, getQueue, moveInQueue, nextInQueueIndex, previousInQueueIndex, removeFromQueue, setQueueIndex, syncQueueVideo } from '../../../src/player/queue'

describe('local playback queue', () => {
  beforeEach(() => {
    clearQueue()
  })

  it('appends unique entries in order and ignores duplicates', () => {
    expect(appendQueueEntry({ id: 'v1', title: 'First' })).toBe(true)
    expect(appendQueueEntry({ id: 'v2', title: 'Second' })).toBe(true)
    expect(appendQueueEntry({ id: 'v1', title: 'Duplicate' })).toBe(false)
    expect(getQueue().items.map(item => item.id)).toEqual(['v1', 'v2'])
  })

  it('updates currentIndex cleanly across removals and reorders', () => {
    appendQueueEntry({ id: 'v1', title: 'First' })
    appendQueueEntry({ id: 'v2', title: 'Second' })
    appendQueueEntry({ id: 'v3', title: 'Third' })
    setQueueIndex(1)

    moveInQueue(0, 2)
    expect(getQueue().items.map(item => item.id)).toEqual(['v2', 'v3', 'v1'])
    expect(getQueue().currentIndex).toBe(0)

    moveInQueue(2, 0)
    expect(getQueue().items.map(item => item.id)).toEqual(['v1', 'v2', 'v3'])
    expect(getQueue().currentIndex).toBe(1)

    removeFromQueue(0)
    expect(getQueue().items.map(item => item.id)).toEqual(['v2', 'v3'])
    expect(getQueue().currentIndex).toBe(0)
    expect(nextInQueueIndex()).toBe(1)

    removeFromQueue(0)
    expect(getQueue().items.map(item => item.id)).toEqual(['v3'])
    expect(getQueue().currentIndex).toBe(-1)
    expect(nextInQueueIndex()).toBe(0)
  })

  it('keeps next pointing to the following entry when removing the playing item from the middle', () => {
    appendQueueEntry({ id: 'a', title: 'A' })
    appendQueueEntry({ id: 'b', title: 'B' })
    appendQueueEntry({ id: 'c', title: 'C' })
    setQueueIndex(1)
    removeFromQueue(1)
    expect(getQueue().currentIndex).toBe(-1)
    expect(nextInQueueIndex()).toBe(1)
    expect(getQueue().items[nextInQueueIndex()!]?.id).toBe('c')
    expect(previousInQueueIndex()).toBe(0)
  })

  it('syncs active index by videoId and clears active state on unrelated videos', () => {
    appendQueueEntry({ id: 'v1', title: 'First' })
    appendQueueEntry({ id: 'v2', title: 'Second' })
    syncQueueVideo('v2')
    expect(getQueue().currentIndex).toBe(1)
    syncQueueVideo('unrelated')
    expect(getQueue().currentIndex).toBe(-1)
  })
})
