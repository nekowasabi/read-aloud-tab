/**
 * Simple language detection utility
 * Detects if text is primarily Japanese or other languages
 */

/**
 * Detect the primary language of the given text
 * @param text - Text to analyze
 * @returns Language code ('ja' for Japanese, 'en' for others)
 */
export function detectLanguage(text: string): string {
  if (!text || text.trim().length === 0) {
    return 'en'; // Default to English for empty text
  }

  // Japanese character ranges:
  // Hiragana: U+3040-U+309F
  // Katakana: U+30A0-U+30FF
  // Kanji (CJK Unified Ideographs): U+4E00-U+9FAF
  const japanesePattern = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g;

  // Count Japanese characters
  const japaneseMatches = text.match(japanesePattern);
  const japaneseCharCount = japaneseMatches ? japaneseMatches.length : 0;

  // Count total characters (excluding whitespace)
  const totalCharCount = text.replace(/\s/g, '').length;

  if (totalCharCount === 0) {
    return 'en';
  }

  // If more than 30% of characters are Japanese, consider it Japanese text
  const japaneseRatio = japaneseCharCount / totalCharCount;

  return japaneseRatio > 0.3 ? 'ja' : 'en';
}

/**
 * Check if translation is needed
 * @param sourceText - Source text to check
 * @param targetLanguage - Target language code
 * @returns true if translation is needed, false if source and target are same language
 */
export function isTranslationNeeded(sourceText: string, targetLanguage: string): boolean {
  const sourceLanguage = detectLanguage(sourceText);
  return sourceLanguage !== targetLanguage;
}
