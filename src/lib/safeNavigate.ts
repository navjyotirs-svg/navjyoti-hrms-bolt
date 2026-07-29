export function safeNavigateFromActionUrl(actionUrl: string | null | undefined, navigateFn: (path: string) => void): boolean {
  if (!actionUrl) return false
  if (actionUrl.startsWith('javascript:')) return false
  if (actionUrl.startsWith('http://') || actionUrl.startsWith('https://')) {
    try {
      const parsed = new URL(actionUrl)
      if (parsed.origin !== window.location.origin) return false
      navigateFn(parsed.pathname + parsed.search + parsed.hash)
      return true
    } catch {
      return false
    }
  }
  if (actionUrl.startsWith('/')) {
    navigateFn(actionUrl)
    return true
  }
  return false
}
