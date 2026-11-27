import { useQuery } from 'urql'
import { Redirect } from 'wouter'

import { gql } from '../generated'

const CHANNEL_LIVE_VIDEO_QUERY = gql(`
  query ChannelLiveVideo($channelId: ID!) {
    channelLiveVideo(channelId: $channelId)
  }
`)

/** Resolves a channel's `/live` URL directly to its active stream, falling back to the channel page when offline. */
export const ChannelLiveRedirect = ({ id, base }: { id: string, base: string }) => {
  const [{ data, error, fetching }] = useQuery({
    query: CHANNEL_LIVE_VIDEO_QUERY,
    variables: { channelId: id },
    requestPolicy: 'network-only',
  })
  if (fetching || (!data && !error)) return <div className='route-loading' />
  const videoId = data?.channelLiveVideo
  return <Redirect to={videoId ? `/watch?v=${encodeURIComponent(videoId)}` : base} replace />
}

export default ChannelLiveRedirect
