import type { Group } from '../../../src/groups/store'

import { describe, expect, it } from 'vite-plus/test'

import { suggestGroup } from '../../../src/groups/suggest'
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
})
