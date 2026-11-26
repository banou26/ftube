import type { ChannelCommunityQuery } from '../generated/graphql'

import { css } from '@emotion/react'
import { ArrowLeft } from 'lucide-react'
import { useCallback, useRef, useState } from 'preact/hooks'
import { useQuery } from 'urql'
import { Link, Redirect, useLocation, useSearch } from 'wouter'

import { useDocumentTitle } from '../app'
import { DataFailure } from '../components/data-failure'
import { PostCard } from '../components/post-card'
import { FeedSentinel, useInfiniteFeed } from '../components/use-infinite-feed'
import { gql } from '../generated'

const CHANNEL_COMMUNITY_QUERY = gql(`
  query ChannelCommunity($channelId: ID!, $sort: String, $cursor: String) {
    channelCommunity(channelId: $channelId, sort: $sort, cursor: $cursor) {
      available
      channelId
      title
      avatar
      sortOptions
      appliedSort
      posts {
        items {
          id
          text
          runs { text url videoId startSeconds browseId }
          publishedText
          voteCountText
          likeStatus
          actionsToken
          isCreator
          commentCountText
          commentCountLabel
          attachedImage
          attachedImages
          author { id name avatar isVerified isVerifiedArtist }
          attachedVideo {
            id
            title
            thumbnail
            thumbnailSrcset
            durationSeconds
            viewCount
            publishedText
            channel { id name }
          }
          poll {
            totalVotesText
            choices { text votePercentage image }
          }
        }
        cursor
      }
    }
  }
`)

type CommunityPageData = ChannelCommunityQuery['channelCommunity']
type CommunityPostsPage = CommunityPageData['posts']

const style = css`
  width: max(min(100% - 3.2rem, 64.2rem), min(128.4rem, round(down, 100% - 4.8rem, 21.4rem)));
  margin: 0 auto;
  padding: 2.4rem 0 4.8rem;

  .back-link {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 1.6rem;
    font-size: 1.4rem;
    font-weight: 500;
    color: var(--text-secondary);
    text-decoration: none;
  }

  .back-link:hover {
    color: var(--text-primary);
  }

  .header {
    display: flex;
    align-items: center;
    gap: 1.6rem;
    padding-bottom: 1.6rem;
    border-bottom: 1px solid var(--border-subtle);
  }

  .avatar {
    flex: none;
    width: 6.4rem;
    height: 6.4rem;
    border-radius: 50%;
    object-fit: cover;
    background: var(--bg-elevated);
  }

  .title {
    margin: 0;
    font-size: 2.6rem;
    font-weight: 700;
    line-height: 3.4rem;
    color: var(--text-primary);
  }

  .sorts {
    display: flex;
    flex-wrap: wrap;
    gap: 0.8rem;
    padding: 1.6rem 0 0;
  }

  .sort {
    height: 3.2rem;
    padding: 0 1.2rem;
    border: none;
    border-radius: 0.8rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    font: inherit;
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .sort:hover {
    background: var(--bg-chip-hover);
  }

  .sort.active {
    background: var(--bg-inverse);
    color: var(--text-inverse);
  }

  .posts {
    display: flex;
    flex-direction: column;
    gap: 1.6rem;
    max-width: 64.2rem;
    margin-top: 2rem;
  }

  .post-skeleton {
    padding: 1.6rem;
    border: 1px solid var(--border-subtle);
    border-radius: 1.2rem;
  }

  .post-skeleton-head {
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }

  .post-skeleton-avatar {
    width: 2.4rem;
    height: 2.4rem;
    border-radius: 50%;
    background: var(--bg-elevated);
  }

  .post-skeleton-line {
    height: 1.4rem;
    border-radius: 0.4rem;
    background: var(--bg-elevated);
  }

  .post-skeleton-line.author {
    width: 14rem;
  }

  .post-skeleton-line.body {
    width: 85%;
    margin-top: 1.4rem;
  }

  .post-skeleton-line.short {
    width: 52%;
    margin-top: 0.8rem;
  }

  .status {
    margin-top: 2.4rem;
    font-size: 1.4rem;
    color: var(--text-secondary);
  }
`

const CommunityPostSkeleton = () => (
  <div className='post-skeleton' aria-hidden='true'>
    <div className='post-skeleton-head'>
      <div className='post-skeleton-avatar' />
      <div className='post-skeleton-line author' />
    </div>
    <div className='post-skeleton-line body' />
    <div className='post-skeleton-line short' />
  </div>
)

export const ChannelCommunityPage = ({ id, base }: { id: string, base: string }) => {
  const [, setLocation] = useLocation()
  const rawSearch = useSearch()
  const searchParams = new URLSearchParams(rawSearch)
  const sort = searchParams.get('sort') || undefined
  const scopeKey = `${id}:${sort ?? ''}`

  const [pagesState, setPagesState] = useState<{ key: string, pages: CommunityPostsPage[] }>({
    key: scopeKey,
    pages: [],
  })
  const pages = pagesState.key === scopeKey ? pagesState.pages : []
  const loadingCursor = useRef<string | undefined>(undefined)
  const lastBase = useRef<CommunityPageData | undefined>(undefined)

  const cursor = pages[pages.length - 1]?.cursor ?? undefined
  const [{ data, error, fetching }, reexecute] = useQuery({
    query: CHANNEL_COMMUNITY_QUERY,
    variables: { channelId: id, sort, cursor },
  })

  if (data?.channelCommunity) {
    lastBase.current = data.channelCommunity
  }

  const community = data?.channelCommunity ?? (fetching ? lastBase.current : undefined)
  const currentPosts = data?.channelCommunity.posts
  const { items: posts, cursor: nextCursor } = useInfiniteFeed({
    pages: currentPosts ? [...pages, currentPosts] : pages,
    key: post => post.id,
  })

  if (loadingCursor.current && !fetching) {
    loadingCursor.current = undefined
  }

  const onMorePosts = useCallback(() => {
    if (!nextCursor || fetching || loadingCursor.current === nextCursor) return
    const pageToCommit = currentPosts
    if (!pageToCommit) return
    loadingCursor.current = nextCursor
    setPagesState(prev => ({
      key: scopeKey,
      pages: [...(prev.key === scopeKey ? prev.pages : []), pageToCommit],
    }))
  }, [currentPosts, fetching, nextCursor, scopeKey])

  useDocumentTitle(community?.title || 'Community')

  if (!fetching && data && !data.channelCommunity.available) {
    const redirectParams = new URLSearchParams(rawSearch)
    redirectParams.delete('sort')
    const rest = redirectParams.size > 0 ? `?${redirectParams}` : ''
    return <Redirect to={`${base}/posts${rest}`} replace />
  }

  const sortOptions = community?.sortOptions ?? []
  const activeSort = sort ?? community?.appliedSort ?? sortOptions[0]
  const defaultSort = sortOptions[0]

  const selectSort = (option: string) => {
    const nextParams = new URLSearchParams(rawSearch)
    if (defaultSort && option === defaultSort) {
      nextParams.delete('sort')
    } else {
      nextParams.set('sort', option)
    }
    const queryString = nextParams.size > 0 ? `?${nextParams}` : ''
    setPagesState({ key: `${id}:${defaultSort && option === defaultSort ? '' : option}`, pages: [] })
    loadingCursor.current = undefined
    setLocation(`${base}/community${queryString}`)
  }

  return (
    <main css={style}>
      <Link href={base} className='back-link'>
        <ArrowLeft size={16} strokeWidth={1.75} />
        Back to channel
      </Link>
      {community
        ? (
          <header className='header'>
            {community.avatar ? <img className='avatar' src={community.avatar} alt='' loading='lazy' /> : undefined}
            <h1 className='title'>{community.title || 'Community'}</h1>
          </header>
        )
        : (
          <header className='header'>
            <h1 className='title'>Community</h1>
          </header>
        )}
      {sortOptions.length > 1
        ? (
          <div className='sorts' role='group' aria-label='Sort community posts'>
            {sortOptions.map((option) => {
              const selected = option === activeSort
              return (
                <button
                  key={option}
                  type='button'
                  className={selected ? 'sort active' : 'sort'}
                  aria-pressed={selected}
                  onClick={() => selectSort(option)}
                >
                  {option}
                </button>
              )
            })}
          </div>
        )
        : undefined}
      <div className='posts'>
        {posts.map(post => <PostCard key={post.id} post={post} />)}
        {fetching && !error
          ? Array.from({ length: posts.length === 0 ? 3 : 1 }, (_, index) => (
            <CommunityPostSkeleton key={`community-skeleton-${index}`} />
          ))
          : undefined}
      </div>
      {error && !fetching ? <DataFailure error={error} reexecute={reexecute} /> : undefined}
      {data && !fetching && !error && posts.length === 0
        ? <p className='status'>No community posts yet.</p>
        : undefined}
      <FeedSentinel onVisible={onMorePosts} disabled={fetching || Boolean(error) || !nextCursor} />
    </main>
  )
}

export default ChannelCommunityPage
