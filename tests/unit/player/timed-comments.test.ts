import { describe, expect, it } from 'vite-plus/test'

import {
  beginTimedCommentSeek,
  createTimedCommentClockState,
  extractTimedCommentCues,
  finishTimedCommentSeek,
  formatTimedCommentAnnouncement,
  isTimestampOnlyComment,
  parseLikeCountText,
  stepTimedCommentClock,
  stripTriggeringTimestampRuns,
  timedCommentCueToChatRow,
} from '../../../src/player/timed-comments'

describe('timed comments helpers and media clock', () => {
  it('parses like counts including commas and compact suffixes', () => {
    expect(parseLikeCountText(undefined)).toBe(0)
    expect(parseLikeCountText('')).toBe(0)
    expect(parseLikeCountText('bad')).toBe(0)
    expect(parseLikeCountText('42')).toBe(42)
    expect(parseLikeCountText('1,234')).toBe(1234)
    expect(parseLikeCountText('1.2K')).toBe(1200)
    expect(parseLikeCountText('3.5m')).toBe(3_500_000)
    expect(parseLikeCountText('2B')).toBe(2_000_000_000)
  })

  it('rejects timestamp-only comments while keeping reactions with text or emoji', () => {
    expect(isTimestampOnlyComment([])).toBe(true)
    expect(isTimestampOnlyComment([{ text: '2:14', videoId: 'v1', startSeconds: 134 }])).toBe(true)
    expect(isTimestampOnlyComment([
      { text: '2:14', videoId: 'v1', startSeconds: 134 },
      { text: ' - ', videoId: null, startSeconds: null },
      { text: '2:30', videoId: 'v1', startSeconds: 150 },
    ])).toBe(true)
    expect(isTimestampOnlyComment([
      { text: '2:14', videoId: 'v1', startSeconds: 134 },
      { text: ' 🔥', videoId: null, startSeconds: null },
    ])).toBe(false)
    expect(isTimestampOnlyComment([
      { text: 'Best part at ', videoId: null, startSeconds: null },
      { text: '2:14', videoId: 'v1', startSeconds: 134 },
    ])).toBe(false)
  })

  it('extracts valid cues using first matching video timestamp, skipping invalid/timestamp-only, and preferring highest likes per timestamp', () => {
    const cues = extractTimedCommentCues([
      {
        id: 'ts-only',
        text: '0:15',
        likeCountText: '999',
        runs: [{ text: '0:15', videoId: 'v1', startSeconds: 15 }],
      },
      {
        id: 'wrong-video',
        text: '0:20 on other video',
        likeCountText: '500',
        runs: [
          { text: '0:20', videoId: 'other', startSeconds: 20 },
          { text: ' on other video', videoId: null, startSeconds: null },
        ],
      },
      {
        id: 'out-of-range',
        text: '5:00 past duration',
        likeCountText: '400',
        runs: [
          { text: '5:00', videoId: 'v1', startSeconds: 300 },
          { text: ' past duration', videoId: null, startSeconds: null },
        ],
      },
      {
        id: 'negative',
        text: '-1s',
        runs: [
          { text: '-1s', videoId: 'v1', startSeconds: -1 },
          { text: ' invalid', videoId: null, startSeconds: null },
        ],
      },
      {
        id: 'first-valid',
        text: 'Skip 0:10\nuse 0:42\nthen 1:20',
        likeCountText: '12',
        runs: [
          { text: 'Skip ' },
          { text: '0:10', videoId: 'other', startSeconds: 10 },
          { text: '\nuse ' },
          { text: '0:42', videoId: 'v1', startSeconds: 42 },
          { text: '\nthen ' },
          { text: '1:20', videoId: 'v1', startSeconds: 80 },
        ],
      },
      {
        id: 'lower-likes',
        text: '1:00 second place',
        likeCountText: '200',
        runs: [
          { text: '1:00', videoId: 'v1', startSeconds: 60 },
          { text: ' second place' },
        ],
      },
      {
        id: 'higher-likes',
        text: '1:00 most liked',
        likeCountText: '1.5K',
        runs: [
          { text: '1:00', videoId: 'v1', startSeconds: 60 },
          { text: ' most liked' },
        ],
      },
      {
        id: 'zero-cue',
        text: '0:00 opening frame',
        likeCountText: '5',
        runs: [
          { text: '0:00', videoId: 'v1', startSeconds: 0 },
          { text: ' opening frame' },
        ],
      },
    ], 'v1', 200)

    expect(cues.map((cue) => ({ id: cue.id, ts: cue.timestampSeconds, likes: cue.likeCount, text: cue.text }))).toEqual([
      { id: 'zero-cue', ts: 0, likes: 5, text: 'opening frame' },
      { id: 'first-valid', ts: 42, likes: 12, text: 'Skip 0:10 use then 1:20' },
      { id: 'higher-likes', ts: 60, likes: 1500, text: 'most liked' },
    ])

    const row = timedCommentCueToChatRow(cues[2]!)
    expect(row.id).toBe('timed-comment:higher-likes:60')
    expect(row.text).toBe('most liked')
    expect(extractTimedCommentCues([], 'v1', 200)).toEqual([])
    expect(extractTimedCommentCues(cues.map((c) => ({ id: c.id, text: c.text, runs: c.runs })), 'v1', 0)).toEqual([])
  })

  it('strips only the triggering timestamp and normalizes surrounding spacing across overlay edge cases', () => {
    const metrikOriginalRuns = [
      { text: 'Absolute perfection!' },
      { text: '10:15', videoId: 'uvQJfHp6gVk', startSeconds: 615 },
      { text: ' Highlight, i miss this in 2014, poor me!' },
    ]
    const metrikSnapshot = structuredClone(metrikOriginalRuns)

    const cases: Array<{
      id: string
      videoId?: string
      duration?: number
      runs: Array<{ text: string, videoId?: string | null, startSeconds?: number | null }>
      expected: string
    }> = [
      {
        id: 'metrik-exact',
        videoId: 'uvQJfHp6gVk',
        duration: 700,
        runs: metrikOriginalRuns,
        expected: 'Absolute perfection! Highlight, i miss this in 2014, poor me!',
      },
      {
        id: 'metrik-newlines',
        videoId: 'uvQJfHp6gVk',
        duration: 700,
        runs: [
          { text: 'Absolute perfection!\n' },
          { text: '10:15', videoId: 'uvQJfHp6gVk', startSeconds: 615 },
          { text: '\nHighlight, i miss this in 2014, poor me!' },
        ],
        expected: 'Absolute perfection! Highlight, i miss this in 2014, poor me!',
      },
      {
        id: 'no-spaces-either-side',
        videoId: 'uvQJfHp6gVk',
        duration: 700,
        runs: [
          { text: 'Absolute perfection!' },
          { text: '10:15', videoId: 'uvQJfHp6gVk', startSeconds: 615 },
          { text: 'Highlight' },
        ],
        expected: 'Absolute perfection! Highlight',
      },
      {
        id: 'leading-plain',
        runs: [{ text: '1:00', videoId: 'v1', startSeconds: 60 }, { text: ' most liked' }],
        expected: 'most liked',
      },
      {
        id: 'leading-hyphen-sep',
        runs: [{ text: '1:00', videoId: 'v1', startSeconds: 60 }, { text: ' - most liked' }],
        expected: 'most liked',
      },
      {
        id: 'leading-colon-sep',
        runs: [{ text: '1:00', videoId: 'v1', startSeconds: 60 }, { text: ': most liked' }],
        expected: 'most liked',
      },
      {
        id: 'leading-negative-number',
        runs: [{ text: '1:00', videoId: 'v1', startSeconds: 60 }, { text: ' -5 degrees' }],
        expected: '-5 degrees',
      },
      {
        id: 'mid-sentence',
        runs: [
          { text: 'Check out ' },
          { text: '10:15', videoId: 'v1', startSeconds: 615 },
          { text: ' for the drop' },
        ],
        expected: 'Check out for the drop',
      },
      {
        id: 'before-exclamation',
        runs: [
          { text: 'Drop at ' },
          { text: '10:15', videoId: 'v1', startSeconds: 615 },
          { text: '! Wild' },
        ],
        expected: 'Drop at! Wild',
      },
      {
        id: 'before-comma',
        runs: [
          { text: 'Wait for ' },
          { text: '10:15', videoId: 'v1', startSeconds: 615 },
          { text: ', trust me' },
        ],
        expected: 'Wait for, trust me',
      },
      {
        id: 'wrapped-parens',
        runs: [
          { text: 'Best part (' },
          { text: '10:15', videoId: 'v1', startSeconds: 615 },
          { text: ') is here' },
        ],
        expected: 'Best part is here',
      },
      {
        id: 'leading-wrapped-parens',
        runs: [
          { text: '(' },
          { text: '10:15', videoId: 'v1', startSeconds: 615 },
          { text: ') Best part' },
        ],
        expected: 'Best part',
      },
      {
        id: 'wrapped-brackets-punct',
        runs: [
          { text: 'Best part [' },
          { text: '10:15', videoId: 'v1', startSeconds: 615 },
          { text: ']!' },
        ],
        expected: 'Best part!',
      },
      {
        id: 'trailing-plain',
        runs: [{ text: 'Best drop ' }, { text: '10:15', videoId: 'v1', startSeconds: 615 }],
        expected: 'Best drop',
      },
      {
        id: 'trailing-hyphen-sep',
        runs: [{ text: 'Best drop - ' }, { text: '10:15', videoId: 'v1', startSeconds: 615 }],
        expected: 'Best drop',
      },
      {
        id: 'trailing-colon-sep',
        runs: [{ text: 'Best drop: ' }, { text: '10:15', videoId: 'v1', startSeconds: 615 }],
        expected: 'Best drop',
      },
      {
        id: 'multi-timestamp-first-triggers',
        runs: [
          { text: '0:10', videoId: 'v1', startSeconds: 10 },
          { text: ' intro\n' },
          { text: '10:15', videoId: 'v1', startSeconds: 615 },
          { text: ' drop\n' },
          { text: '12:00', videoId: 'v1', startSeconds: 720 },
          { text: ' outro' },
        ],
        expected: 'intro 10:15 drop 12:00 outro',
      },
      {
        id: 'emoji-reaction',
        runs: [{ text: '2:14', videoId: 'v1', startSeconds: 134 }, { text: ' 🔥' }],
        expected: '🔥',
      },
    ]

    for (const c of cases) {
      const cues = extractTimedCommentCues(
        [{ id: c.id, text: c.runs.map((r) => r.text).join(''), runs: c.runs }],
        c.videoId ?? 'v1',
        c.duration ?? 1000,
      )
      expect(cues, c.id).toHaveLength(1)
      expect(cues[0]!.text, c.id).toBe(c.expected)
    }

    expect(metrikOriginalRuns).toEqual(metrikSnapshot)
    expect(stripTriggeringTimestampRuns(metrikOriginalRuns, 1).map((r) => r.text).join('')).toBe(
      'Absolute perfection! Highlight, i miss this in 2014, poor me!',
    )
  })

  it('schedules cues on forward playback, clears and skips across seeks, and re-triggers after rewind', () => {
    const cues = extractTimedCommentCues([
      {
        id: 'c0',
        text: '0:00 start',
        runs: [{ text: '0:00', videoId: 'v1', startSeconds: 0 }, { text: ' start' }],
      },
      {
        id: 'c1',
        text: '0:42 midpoint',
        runs: [{ text: '0:42', videoId: 'v1', startSeconds: 42 }, { text: ' midpoint' }],
      },
      {
        id: 'c2',
        text: '1:00 chorus',
        runs: [{ text: '1:00', videoId: 'v1', startSeconds: 60 }, { text: ' chorus' }],
      },
      {
        id: 'c3',
        text: '1:05 solo',
        runs: [{ text: '1:05', videoId: 'v1', startSeconds: 65 }, { text: ' solo' }],
      },
    ], 'v1', 120)

    let state = createTimedCommentClockState(0)
    let step = stepTimedCommentClock(state, 0.25, cues)
    state = step.state
    expect(step.clear).toBe(false)
    expect(step.cue?.id).toBe('c0')

    // Advancing normally across 0:42 emits c1
    step = stepTimedCommentClock(state, 41.8, cues)
    state = step.state
    expect(step.cue).toBeUndefined()

    step = stepTimedCommentClock(state, 42.3, cues)
    state = step.state
    expect(step.cue?.id).toBe('c1')

    // Fast tick (e.g. 2x speed) crossing 1:00 and 1:05 emits at most one cue
    step = stepTimedCommentClock(state, 59.5, cues)
    state = step.state
    step = stepTimedCommentClock(state, 66.0, cues)
    state = step.state
    expect(step.cue?.id).toBe('c3')

    // Rewinding backward clears active items and lets 0:42 fire again on crossing
    step = stepTimedCommentClock(state, 40.0, cues)
    state = step.state
    expect(step.clear).toBe(true)
    expect(step.cue).toBeUndefined()

    step = stepTimedCommentClock(state, 42.4, cues)
    state = step.state
    expect(step.clear).toBe(false)
    expect(step.cue?.id).toBe('c1')

    // Seeking forward across 1:00 and 1:05 clears overlay and skips both cues
    state = beginTimedCommentSeek(state, 42.4)
    state = finishTimedCommentSeek(state, 70.0)
    step = stepTimedCommentClock(state, 70.3, cues)
    state = step.state
    expect(step.cue).toBeUndefined()

    // Seeking directly onto a cue timestamp skips that cue until rewound before it
    state = beginTimedCommentSeek(state, 70.3)
    state = finishTimedCommentSeek(state, 60.0)
    step = stepTimedCommentClock(state, 60.2, cues)
    state = step.state
    expect(step.cue).toBeUndefined()

    step = stepTimedCommentClock(state, 59.0, cues)
    state = step.state
    expect(step.clear).toBe(true)
    step = stepTimedCommentClock(state, 60.2, cues)
    expect(step.cue?.id).toBe('c2')
  })

  it('formats screen-reader announcement text with optional author attribution', () => {
    expect(formatTimedCommentAnnouncement({
      text: '10:15 Highlight!',
      author: { id: 'UC-1', name: ' @Thompson7177 ' },
    }, true)).toBe('@Thompson7177: 10:15 Highlight!')
    expect(formatTimedCommentAnnouncement({
      text: '10:15 Highlight!',
      author: { id: 'UC-1', name: '@Thompson7177' },
    }, false)).toBe('10:15 Highlight!')
    expect(formatTimedCommentAnnouncement({
      text: '10:15 Highlight!',
      author: { id: 'UC-1', name: '   ' },
    }, true)).toBe('10:15 Highlight!')
    expect(formatTimedCommentAnnouncement({
      text: '10:15 Highlight!',
      author: undefined,
    }, true)).toBe('10:15 Highlight!')
  })
})
