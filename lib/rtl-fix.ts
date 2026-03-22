/**
 * Fix reversed Latin/digit sequences in Hebrew item names.
 *
 * The Finansit system stores item names with reversed Latin character and digit
 * sequences due to RTL input handling. For example "702" instead of "207" (Peugeot 207),
 * "ITG" instead of "GTI", "LATOT" instead of "TOTAL".
 *
 * This function finds all consecutive runs of Latin letters and/or digits within
 * Hebrew text and reverses each run back to the correct order.
 */
export function fixRtlItemName(name: string): string {
  if (!name) return name

  // If text contains no Hebrew characters, return as-is (pure Latin/numeric codes)
  const hebrewRange = /[\u0590-\u05FF]/
  if (!hebrewRange.test(name)) return name

  // Find consecutive runs of Latin letters (A-Za-z) and/or digits (0-9)
  // Dots, slashes, hyphens, spaces etc. break a run
  return name.replace(/[A-Za-z0-9]+/g, (match) => {
    return match.split('').reverse().join('')
  })
}
