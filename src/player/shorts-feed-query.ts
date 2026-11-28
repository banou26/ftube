import { gql } from '../generated'

/** Shared Shorts sequence query used by both `/shorts` and the docked Shorts miniplayer. */
export const SHORTS_FEED_QUERY = gql(`
  query ShortsFeed($seed: ID, $sequence: String, $cursor: String) {
    shorts(seed: $seed, sequence: $sequence, cursor: $cursor) {
      items { id poster title }
      cursor
    }
  }
`)
