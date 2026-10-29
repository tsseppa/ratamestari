const STORAGE_PREFIX = 'ratamestari.contourInterval.'

// A map's own contour interval, set by the user, is kept per map like its symbol corrections.
export function loadContourInterval(mapKey: string): number | null {
  try {
    const stored = Number(localStorage.getItem(STORAGE_PREFIX + mapKey))
    return Number.isFinite(stored) && stored > 0 ? stored : null
  } catch {
    return null
  }
}

export function saveContourInterval(mapKey: string, meters: number | null) {
  try {
    if (meters === null) localStorage.removeItem(STORAGE_PREFIX + mapKey)
    else localStorage.setItem(STORAGE_PREFIX + mapKey, String(meters))
  } catch {
    // Without storage the interval lasts until the page is reloaded.
  }
}

export function contourIntervalFrom(typed: string): number | null {
  const meters = Number(typed)
  return typed.trim() !== '' && Number.isFinite(meters) && meters > 0 ? meters : null
}
