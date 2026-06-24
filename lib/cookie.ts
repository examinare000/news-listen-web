/**
 * Pure function to extract a named cookie value from a cookie string.
 *
 * @param name - The name of the cookie to find
 * @param cookieString - The cookie string to search (e.g., from document.cookie or a test fixture)
 * @returns The value of the named cookie, or undefined if not found
 *
 * Design note: cookieString is passed as an argument (not read from document.cookie)
 * to enable complete isolation and testability without any browser globals.
 */
export function readCookie(
  name: string,
  cookieString: string
): string | undefined {
  if (!cookieString) {
    return undefined
  }

  // Split by semicolon to get individual cookie pairs
  const pairs = cookieString.split(';')

  for (const pair of pairs) {
    // Trim whitespace
    const trimmed = pair.trim()

    // Find the first equals sign to split name and value
    const equalsIndex = trimmed.indexOf('=')
    if (equalsIndex === -1) {
      // No equals sign found, skip this pair
      continue
    }

    const cookieName = trimmed.substring(0, equalsIndex).trim()

    // Check if this is the cookie we're looking for
    if (cookieName === name) {
      // Return everything after the first equals sign as the value
      return trimmed.substring(equalsIndex + 1)
    }
  }

  return undefined
}
