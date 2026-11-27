import type { Group } from '../../../src/groups/store'

import { describe, expect, it } from 'vite-plus/test'

import { suggestGroup, suggestGroups } from '../../../src/groups/suggest'
import { parseChannelKeywords } from '../../../src/sources/youtube/normalize'

const group = (id: string, name: string, emoji: string, channels: string[] = [], parentId?: string): Group => ({
  id,
  name,
  emoji,
  channels: channels.map(channelId => ({ id: channelId, name: channelId })),
  updatedAt: 1,
  ...(parentId ? { parentId } : {}),
})

// Groups shaped like the owner's nested workspace
const USER_GROUPS: Group[] = [
  group('asmr', 'ASMR', '🎧'),
  group('vod', 'VOD', '📺'),
  group('gaming', 'Gaming', '🎮'),
  group('trailers', 'Trailers', '🎬', [], 'gaming'),
  group('cars', 'Cars', '🚗'),
  group('f1', 'F1', '🏎️', [], 'cars'),
  group('sub', 'Test sub sub', '📁', [], 'f1'),
  group('slop', 'Slop', '📁'),
]

describe('suggestGroup', () => {
  it('matches real channels to an existing user group when close enough', () => {
    expect(suggestGroup({
      id: 'UCKy1dAqELo0zrOtPkf0eTMw',
      name: 'IGN',
      tags: parseChannelKeywords('IGN IGN.com Entertainment "Video Games" Game Reviews Movie Trailer Walkthrough cheats gameplay e3 gaming videogames gamer videogaming "video games" consoles "game reviews" "video game reviews" tech gear trailers'),
      description: 'IGN brings you daily videos about the latest gaming and entertainment news.',
    }, USER_GROUPS)).toEqual({ kind: 'existing', group: USER_GROUPS[2] })

    expect(suggestGroup({
      id: 'UCB_qr75-ydFVKSF9Dmo6izg',
      name: 'FORMULA 1',
      handle: '@Formula1',
      tags: parseChannelKeywords('F1 "Formula One" "Formula 1"'),
    }, USER_GROUPS)).toEqual({ kind: 'existing', group: USER_GROUPS[5] })

    expect(suggestGroup({
      id: 'UC_gibi',
      name: 'Gibi ASMR',
      handle: '@GibiASMR',
      tags: parseChannelKeywords('ASMR gibi "gibi asmr" sleep "stress relief" relax relaxation "for sleep"'),
    }, USER_GROUPS)).toEqual({ kind: 'existing', group: USER_GROUPS[0] })

    expect(suggestGroup({
      id: 'UC_jdg',
      name: 'Joueur Du Grenier',
      handle: '@joueurdugrenier',
      tags: parseChannelKeywords('joueur du grenier test jeu vidéo megadrive nintendo vieilles consoles jaune reviews retro gaming'),
    }, USER_GROUPS)).toEqual({ kind: 'existing', group: USER_GROUPS[2] })

    expect(suggestGroup({
      id: 'UC_donut',
      name: 'Donut',
      handle: '@Donut',
      tags: parseChannelKeywords('cars "car culture" "car mods" "drag racing" "off road" drifting racing JDM'),
    }, USER_GROUPS)).toEqual({ kind: 'existing', group: USER_GROUPS[4] })
  })

  it('suggests creating a relevant new group when no existing group fits closely', () => {
    expect(suggestGroup({
      id: 'UCXuqSBlHAE6Xw-yeJA0Tunw',
      name: 'Linus Tech Tips',
      tags: parseChannelKeywords('Unboxing Review Computer Hardware Motherboard Intel AMD NVIDIA gaming'),
    }, USER_GROUPS)).toEqual({ kind: 'new', name: 'Tech', emoji: '💻' })

    expect(suggestGroup({
      id: 'UCsBjURrPoezykLs9EqgamOA',
      name: 'Fireship',
      tags: parseChannelKeywords('angular firebase web development javascript typescript'),
    }, USER_GROUPS)).toEqual({ kind: 'new', name: 'Programming', emoji: '💻' })

    expect(suggestGroup({
      id: 'UC_3b1b',
      name: '3Blue1Brown',
      handle: '@3blue1brown',
      tags: parseChannelKeywords('Mathematics'),
    }, USER_GROUPS)).toEqual({ kind: 'new', name: 'Mathematics', emoji: '🔬' })

    expect(suggestGroup({
      id: 'UCSMOQeBJ2RAnuFungnQOxLg',
      name: 'Blender',
      tags: parseChannelKeywords('blender "Blender Foundation" 3d "free software" "Creative Commons" tutorials'),
    }, USER_GROUPS)).toEqual({ kind: 'new', name: '3D', emoji: '🎨' })
  })

  it('uses description and verified artist metadata when tags are only vanity or absent', () => {
    expect(suggestGroup({
      id: 'UCBJycsmduvYEL83R_U4JriQ',
      name: 'Marques Brownlee',
      handle: '@mkbhd',
      tags: ['MKBHD', 'MarquesBrownlee', 'Marques Brownlee'],
      description: 'MKBHD: Quality Tech Videos | YouTuber | Consumer Electronics | Tech Head',
    }, [])).toEqual({ kind: 'new', name: 'Tech', emoji: '💻' })

    expect(suggestGroup({
      id: 'UCuAXFkgsw1L7xaCfnd5JJOw',
      name: 'Rick Astley',
      isVerifiedArtist: true,
      tags: parseChannelKeywords('Official Rick Astley "rick astley" "never gonna give you up" "official video" "official audio" meme'),
    }, [])).toEqual({ kind: 'new', name: 'Music', emoji: '🎵' })
  })

  it('does not re-suggest a group the channel is already in or duplicate an existing group', () => {
    const groupsWithIgn = USER_GROUPS.map(entry =>
      entry.id === 'gaming'
        ? group('gaming', 'Gaming', '🎮', ['UCKy1dAqELo0zrOtPkf0eTMw'])
        : entry,
    )
    expect(suggestGroup({
      id: 'UCKy1dAqELo0zrOtPkf0eTMw',
      name: 'IGN',
      tags: parseChannelKeywords('"Video Games" Gaming'),
    }, groupsWithIgn)).toBeUndefined()

    const techGroup = group('tech', 'Tech', '💻')
    expect(suggestGroup({
      id: 'UCXuqSBlHAE6Xw-yeJA0Tunw',
      name: 'Linus Tech Tips',
      tags: parseChannelKeywords('Computer Hardware Motherboard'),
    }, [techGroup])).toEqual({ kind: 'existing', group: techGroup })
  })

  it('returns undefined when a channel has no relevant topic tags or description', () => {
    expect(suggestGroup({
      id: 'UCempty00000000000000001',
      name: 'Mystery',
      handle: '@mystery',
      tags: ['Mystery', 'official', 'videos', 'YouTube', '4K', 'youtube.com', '12345'],
      description: 'Subscribe for new videos every week.',
    }, USER_GROUPS)).toBeUndefined()
  })

  it('ignores boilerplate description phrases when matching existing groups', () => {
    const extraGroups = [
      group('business', 'Business', '💼'),
      group('music', 'Music', '🎵'),
      group('news', 'News', '📰'),
      group('fun', 'Fun', '🎉'),
    ]
    expect(suggestGroup({
      id: 'UCdesc1',
      name: 'PlayThroughs',
      description: 'I play games. For business inquiries: foo@example.com',
    }, extraGroups)).toBeUndefined()

    expect(suggestGroup({
      id: 'UCdesc2',
      name: 'BlockWorld',
      description: 'Minecraft lets plays. Music by Epidemic Sound',
    }, extraGroups)).toBeUndefined()

    expect(suggestGroup({
      id: 'UCdesc3',
      name: 'Updates',
      description: 'Subscribe for news about my channel',
    }, extraGroups)).toBeUndefined()

    expect(suggestGroup({
      id: 'UCdesc4',
      name: 'Friends',
      description: 'Just having fun with friends',
    }, extraGroups)).toBeUndefined()
  })

  it('avoids false positives on ambiguous aliases and falls back to uppercase AI', () => {
    expect(suggestGroup({
      id: 'UCrust',
      name: 'Island',
      tags: ['rust', 'survival'],
    }, USER_GROUPS)).toEqual({ kind: 'new', name: 'Rust', emoji: '📁' })

    expect(suggestGroup({
      id: 'UCpuppy',
      name: 'Paws',
      tags: ['training', 'puppy'],
    }, USER_GROUPS)).toEqual({ kind: 'new', name: 'Pets', emoji: '🐶' })

    expect(suggestGroup({
      id: 'UCkerbal',
      name: 'Orbiter',
      tags: ['space', 'kerbal'],
    }, USER_GROUPS)).toEqual({ kind: 'new', name: 'Space', emoji: '📁' })

    expect(suggestGroup({
      id: 'UCai',
      name: 'PromptLab',
      tags: ['ai'],
    }, USER_GROUPS)).toEqual({ kind: 'new', name: 'AI', emoji: '📁' })
  })

  it('filters vanity brand words, matches alias-named groups without duplicating them, and enforces the >= 80 secondary bar', () => {
    expect(suggestGroup({
      id: 'UCflamingo',
      name: 'Flamingo Studio',
      tags: ['flamingo highlights', 'flamingo vlog'],
    }, [])).toBeUndefined()

    const videoGamesGroup = group('vg', 'Video Games', '🎮')
    expect(suggestGroup({
      id: 'UCesport',
      name: 'ProMatch',
      tags: ['esport'],
    }, [videoGamesGroup])).toEqual({ kind: 'existing', group: videoGamesGroup })

    const joinedVideoGames = group('vg', 'Video Games', '🎮', ['UCesport'])
    expect(suggestGroup({
      id: 'UCesport',
      name: 'ProMatch',
      tags: ['esport'],
    }, [joinedVideoGames])).toBeUndefined()

    const joinedGamingWithTrailers = [
      group('gaming', 'Gaming', '🎮', ['UCKy1dAqELo0zrOtPkf0eTMw']),
      group('trailers', 'Trailers', '🎬'),
    ]
    // Weak secondary tag (score < 80) stays undefined once already in top matching group
    expect(suggestGroup({
      id: 'UCKy1dAqELo0zrOtPkf0eTMw',
      name: 'IGN',
      tags: ['gaming', 'teaser'],
    }, joinedGamingWithTrailers)).toBeUndefined()
    // Direct tag hit (score >= 80) still offers the second matching group
    expect(suggestGroup({
      id: 'UCKy1dAqELo0zrOtPkf0eTMw',
      name: 'IGN',
      tags: ['gaming', 'trailers'],
    }, joinedGamingWithTrailers)).toEqual({ kind: 'existing', group: joinedGamingWithTrailers[1] })
  })

  it('matches French keywords and falls back to canonical topic names on tagless channels', () => {
    expect(suggestGroup({
      id: 'UC_canal_f1',
      name: 'CANAL+ Sport',
      tags: ['formule 1', 'grand prix'],
    }, USER_GROUPS)).toEqual({ kind: 'existing', group: USER_GROUPS[5] })

    expect(suggestGroup({
      id: 'UC_fr_tech',
      name: 'Underscore_',
      description: 'Le talk show informatique et technologie hebdomadaire.',
      tags: [],
    }, USER_GROUPS)).toEqual({ kind: 'new', name: 'Tech', emoji: '💻' })

    expect(suggestGroup({
      id: 'UC_gibi_tagless',
      name: 'Gibi ASMR',
      handle: '@GibiASMR',
      tags: [],
    }, USER_GROUPS)).toEqual({ kind: 'existing', group: USER_GROUPS[0] })

    expect(suggestGroup({
      id: 'UC_f1_tagless',
      name: 'Formula 1',
      tags: [],
    }, USER_GROUPS)).toEqual({ kind: 'existing', group: USER_GROUPS[5] })

    // Generic or ambiguous channel names with no matching topic words must stay undefined
    expect(suggestGroup({
      id: 'UC_generic_name',
      name: "John's Random Clips",
      tags: [],
    }, USER_GROUPS)).toBeUndefined()
    expect(suggestGroup({
      id: 'UC_human_nature',
      name: 'Human Nature',
      tags: [],
    }, USER_GROUPS)).toBeUndefined()
    expect(suggestGroup({
      id: 'UC_state_art',
      name: 'State of the Art',
      tags: [],
    }, USER_GROUPS)).toBeUndefined()
    expect(suggestGroup({
      id: 'UC_mind_games',
      name: 'Mind Games',
      tags: [],
    }, USER_GROUPS)).toBeUndefined()
  })
})

describe('suggestGroups', () => {
  it('returns matching existing groups and top 3 clean relevant tags while filtering SEO filler', () => {
    const groupsWithTech = [...USER_GROUPS, group('tech', 'Tech', '💻')]
    const suggestions = suggestGroups({
      id: 'UC55-tEex69n_xJ-F2uB_40w',
      name: 'The Linux Experiment',
      handle: '@TheLinuxEXP',
      description: 'Making Linux accessible: Linux desktop news, simple tutorials, application spotlights.',
      tags: parseChannelKeywords('linux "linux distribution" "switching to linux" "switch to linux" "great linux content" "linux videos" "linux desktop" "linux desktop distro" "best linux shwo" "linux news" "linux tech news" "linux podcast" "linux hardware" "linux reviews" "linux 2025" "best linux" "linux channel" "biggest linux channel" "linux news podcast" "linux news channel" "linux unbiased" "linux resource" "learn linux" "how to linux" "learning linux"'),
    }, groupsWithTech)

    expect(suggestions[0]).toEqual({ kind: 'existing', group: groupsWithTech[groupsWithTech.length - 1] })
    const newNames = suggestions.filter(item => item.kind === 'new').map(item => item.name)
    expect(newNames).toEqual(['Linux', 'Linux Desktop', 'Linux Distribution'])
    expect(newNames).not.toContain('Linux 2025')
    expect(newNames).not.toContain('Best Linux')
    expect(newNames).not.toContain('Linux Videos')
    expect(newNames).not.toContain('Tech')
  })

  it('includes canonical topic plus top 3 clean tags for channels like Veritasium, 3kliksphilip, and Fireship', () => {
    const veritasium = suggestGroups({
      id: 'UCHnyfMqiRRG1u-2MsSQLbXA',
      name: 'Veritasium',
      handle: '@veritasium',
      tags: parseChannelKeywords('"science videos" science "science education" "science literacy" veritasium misconceptions physics education astronomy chemistry biology teaching learning math "united states" finance'),
    }, USER_GROUPS)
    expect(veritasium.map(item => item.kind === 'new' ? item.name : item.group.name)).toEqual([
      'Science',
      'Physics',
      'Education',
      'Astronomy',
    ])

    const kliks = suggestGroups({
      id: 'UCmu9PVIZBk-ZCi-Bf2F2utA',
      name: '3kliksphilip',
      handle: '@3kliksphilip',
      tags: parseChannelKeywords('3kliksphilip "counter strike" cs2 "source 2" "global offensive" csgo'),
    }, [])
    expect(kliks.map(item => item.kind === 'new' ? item.name : item.group.name)).toEqual([
      'CS2',
      'Counter Strike',
      'CSGO',
    ])

    const fireship = suggestGroups({
      id: 'UCsBjURrPoezykLs9EqgamOA',
      name: 'Fireship',
      tags: parseChannelKeywords('angular firebase web development javascript typescript'),
    }, USER_GROUPS)
    expect(fireship.map(item => item.kind === 'new' ? item.name : item.group.name)).toEqual([
      'Programming',
      'Angular',
      'Firebase',
      'Javascript',
    ])
  })

  it('offers multiple existing group matches when relevant, and avoids new tag spam once already in its top group', () => {
    const gamingAndTrailers = [
      group('gaming', 'Gaming', '🎮'),
      group('trailers', 'Trailers', '🎬'),
    ]
    const unjoined = suggestGroups({
      id: 'UCKy1dAqELo0zrOtPkf0eTMw',
      name: 'IGN',
      tags: parseChannelKeywords('"Video Games" Gaming trailers e3 consoles'),
    }, gamingAndTrailers)
    expect(unjoined.slice(0, 2)).toEqual([
      { kind: 'existing', group: gamingAndTrailers[0] },
      { kind: 'existing', group: gamingAndTrailers[1] },
    ])
    expect(unjoined.filter(item => item.kind === 'new').map(item => item.name)).toEqual(['E3', 'Consoles'])

    const joined = [
      group('gaming', 'Gaming', '🎮', ['UCKy1dAqELo0zrOtPkf0eTMw']),
      group('trailers', 'Trailers', '🎬'),
    ]
    expect(suggestGroups({
      id: 'UCKy1dAqELo0zrOtPkf0eTMw',
      name: 'IGN',
      tags: ['Video Games', 'Gaming'],
    }, joined)).toEqual([])

    expect(suggestGroups({
      id: 'UCKy1dAqELo0zrOtPkf0eTMw',
      name: 'IGN',
      tags: ['gaming', 'trailers'],
    }, joined)).toEqual([{ kind: 'existing', group: joined[1] }])
  })
})
