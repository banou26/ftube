/**
 * Keeps progress UI synced at display refresh rate while `video` is playing
 * and stops the animation loop when paused, ended, or inactive.
 */
export const bindSmoothPlaybackLoop = (
  video: HTMLVideoElement,
  onFrame: () => void,
  isActive: () => boolean = () => true,
): () => void => {
  let frameId = 0
  let disposed = false

  const stop = () => {
    if (frameId === 0) return
    cancelAnimationFrame(frameId)
    frameId = 0
  }

  const loop = () => {
    frameId = 0
    if (disposed || video.paused || video.ended || !isActive()) return
    onFrame()
    frameId = requestAnimationFrame(loop)
  }

  const schedule = () => {
    if (disposed || frameId !== 0 || video.paused || video.ended || !isActive()) return
    frameId = requestAnimationFrame(loop)
  }

  const syncOnce = () => {
    if (disposed || !isActive()) return
    onFrame()
  }

  const onPlay = () => {
    syncOnce()
    schedule()
  }

  const onStop = () => {
    stop()
    syncOnce()
  }

  video.addEventListener('play', onPlay)
  video.addEventListener('playing', onPlay)
  video.addEventListener('pause', onStop)
  video.addEventListener('ended', onStop)
  video.addEventListener('emptied', onStop)
  video.addEventListener('timeupdate', syncOnce)
  video.addEventListener('seeked', syncOnce)
  video.addEventListener('loadedmetadata', syncOnce)

  syncOnce()
  schedule()

  return () => {
    disposed = true
    stop()
    video.removeEventListener('play', onPlay)
    video.removeEventListener('playing', onPlay)
    video.removeEventListener('pause', onStop)
    video.removeEventListener('ended', onStop)
    video.removeEventListener('emptied', onStop)
    video.removeEventListener('timeupdate', syncOnce)
    video.removeEventListener('seeked', syncOnce)
    video.removeEventListener('loadedmetadata', syncOnce)
  }
}
