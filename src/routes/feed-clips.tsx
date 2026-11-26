import type { ClipsFeedQuery } from '../generated/graphql'

import { css } from '@emotion/react'
import { Scissors } from 'lucide-react'
import { useState } from 'preact/hooks'
import { useQuery } from 'urql'

import { useDocumentTitle } from '../app'
import { DataFailure } from '../components/data-failure'
import { SignedOutPrompt } from '../components/signed-out-prompt'
import { FeedSentinel, useInfiniteFeed } from '../components/use-infinite-feed'
import { VideoGrid } from '../components/video-grid'
import { gql } from '../generated'
import { useSession } from '../session'

const CLIPS_FEED_QUERY = gql(`
  query ClipsFeed($cursor: String) {
    clips(cursor: $cursor) {
      items {
        id
        title
        inlinePlayerParams
        thumbnail
        thumbnailSrcset
        animatedThumbnail
        durationSeconds
        viewCount
        publishedText
        isLive
        isShort
        progressPercent
        channel { id name avatar isVerified isVerifiedArtist }
        byline { text isVerified isVerifiedArtist }
        collaborators { id name avatar handle subscriberCountText isVerified isVerifiedArtist }
      }
      cursor
    }
  }
`)

type ClipsPage = ClipsFeedQuery['clips']

const style = css`
  padding: 2.4rem 1.6rem;

  .heading {
    margin: 0 0 2.4rem;
    font-size: 2rem;
    font-weight: 700;
    line-height: 2.8rem;
    color: var(--text-primary);
  }

  .empty {
    margin: 0;
    font-size: 1.4rem;
    color: var(--text-secondary);
  }

  .notice {
    margin: 2.4rem 0 0;
    text-align: center;
    font-size: 1.4rem;
    color: var(--text-secondary);
  }
`

const FeedClipsPage = () => {
  useDocumentTitle('Clips')
  const { ready, signedIn } = useSession()
  const [loaded, setLoaded] = useState<ClipsPage[]>([])
  const [{ data, error, fetching }, reexecute] = useQuery({
    query: CLIPS_FEED_QUERY,
    variables: { cursor: loaded[loaded.length - 1]?.cursor },
    pause: !ready || !signedIn,
  })
  const page = data?.clips
  const { items, cursor } = useInfiniteFeed({
    pages: page ? [...loaded, page] : loaded,
    key: video => video.id,
  })

  const onMore = () => {
    if (!page?.cursor || fetching || error) return
    setLoaded(previous => previous[previous.length - 1] === page ? previous : [...previous, page])
  }

  if (!ready) {
    return (
      <main css={style}>
        <h1 className='heading'>Clips</h1>
        <VideoGrid videos={[]} fetching />
      </main>
    )
  }

  if (!signedIn) {
    return (
      <main css={style}>
        <SignedOutPrompt
          icon={Scissors}
          title='Enjoy your clips'
          subtitle='Sign in to see clips you have created'
        />
      </main>
    )
  }

  return (
    <main css={style}>
      <h1 className='heading'>Clips</h1>
      {data && !fetching && !error && items.length === 0
        ? <p className='empty'>No clips yet.</p>
        : <VideoGrid videos={items} fetching={fetching && items.length === 0} inlinePreview />}
      {fetching && items.length > 0 ? <p className='notice'>Loading more…</p> : undefined}
      {error && !fetching ? <DataFailure error={error} reexecute={reexecute} /> : undefined}
      <FeedSentinel onVisible={onMore} disabled={fetching || Boolean(error) || !cursor} />
    </main>
  )
}

export default FeedClipsPage
