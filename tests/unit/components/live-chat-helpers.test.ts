import { describe, expect, it } from 'vite-plus/test'

import {
  activeMentionQuery,
  applyMention,
  filterMentionCandidates,
  isSelfMention,
  mentionTagFor,
  splitMentionRuns,
} from '../../../src/components/live-chat-helpers'

describe('splitMentionRuns', () => {
  it('highlights @mentions at string boundaries and after punctuation', () => {
    expect(splitMentionRuns('@Alice hi! Ask @Bob_99, or (@Carol.dev).')).toEqual([
      { text: '@Alice', mention: '@Alice' },
      { text: ' hi! Ask ' },
      { text: '@Bob_99', mention: '@Bob_99' },
      { text: ', or (' },
      { text: '@Carol.dev', mention: '@Carol.dev' },
      { text: ').' },
    ])
  })

  it('stops @mentions before trailing sentence dots and matches non-Latin scripts', () => {
    expect(splitMentionRuns('Hello @alice. Check @視聴者!')).toEqual([
      { text: 'Hello ' },
      { text: '@alice', mention: '@alice' },
      { text: '. Check ' },
      { text: '@視聴者', mention: '@視聴者' },
      { text: '!' },
    ])
    expect(splitMentionRuns('Visit @bob.dev. Now')).toEqual([
      { text: 'Visit ' },
      { text: '@bob.dev', mention: '@bob.dev' },
      { text: '. Now' },
    ])
    expect(isSelfMention(splitMentionRuns('hi @alice.')[1]!.mention!, { name: 'Alice', handle: '@alice' })).toBe(true)
  })

  it('ignores email addresses inside chat messages', () => {
    expect(splitMentionRuns('mail me at user@example.com for details')).toEqual([
      { text: 'mail me at user@example.com for details' },
    ])
  })
})

describe('mention autocomplete helpers', () => {
  it('detects active @query immediately before the caret', () => {
    expect(activeMentionQuery('@al', 3)).toEqual({ start: 0, query: 'al' })
    expect(activeMentionQuery('hello @bob', 10)).toEqual({ start: 6, query: 'bob' })
    expect(activeMentionQuery('hello @', 7)).toEqual({ start: 6, query: '' })
    expect(activeMentionQuery('user@ex', 7)).toBeUndefined()
    expect(activeMentionQuery('hello world', 11)).toBeUndefined()
  })

  it('applies chosen mention and advances caret after trailing space', () => {
    expect(applyMention('hi @al there', 3, 6, '@AliceDev')).toEqual({
      value: 'hi @AliceDev  there',
      cursor: 13,
    })
    expect(applyMention('@bo', 0, 3, 'Bob')).toEqual({
      value: '@Bob ',
      cursor: 5,
    })
  })

  it('deduplicates and filters candidates newest-first by name or handle', () => {
    const authors = [
      { id: 'u1', name: 'Alice', handle: '@alice_v1' },
      { id: 'u2', name: 'Bob Builder', handle: '@bobb' },
      { id: 'u1', name: 'Alice', handle: '@alice_v2' },
    ]
    expect(filterMentionCandidates(authors, 'ali')).toEqual([
      { id: 'u1', name: 'Alice', handle: '@alice_v2' },
    ])
    expect(filterMentionCandidates(authors, '')).toEqual([
      { id: 'u1', name: 'Alice', handle: '@alice_v2' },
      { id: 'u2', name: 'Bob Builder', handle: '@bobb' },
    ])
    expect(mentionTagFor({ name: 'Stream Viewer', handle: '@viewer1' })).toBe('viewer1')
    expect(mentionTagFor({ name: 'NoHandle' })).toBe('NoHandle')
  })

  it('matches self mentions against either viewer handle or channel name', () => {
    expect(isSelfMention('@myhandle', { name: 'My Channel', handle: '@MyHandle' })).toBe(true)
    expect(isSelfMention('@my channel', { name: 'My Channel', handle: '@MyHandle' })).toBe(true)
    expect(isSelfMention('@other', { name: 'My Channel', handle: '@MyHandle' })).toBe(false)
    expect(isSelfMention('@anyone', undefined)).toBe(false)
  })
})
