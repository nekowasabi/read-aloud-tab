/**
 * Text Chunking Utility for TTS
 *
 * Splits long text into smaller chunks to avoid Web Speech API limitations:
 * - Chrome (Google voices): 200-300 character limit
 * - Chrome (Windows/Ubuntu): ~15 second timeout
 * - Firefox: Similar limitations
 *
 * This utility splits text at sentence boundaries to maintain natural speech flow.
 */

/**
 * Configuration for text chunking
 */
export interface ChunkConfig {
  /** Maximum characters per chunk (default: 300) */
  maxChunkSize?: number;
  /** Minimum characters per chunk to avoid tiny fragments (default: 50) */
  minChunkSize?: number;
}

/**
 * A text chunk with metadata
 */
export interface TextChunk {
  /** The text content of this chunk */
  text: string;
  /** Start position in the original text */
  startOffset: number;
  /** End position in the original text */
  endOffset: number;
  /** Chunk index (0-based) */
  index: number;
}

/**
 * Result of chunking operation
 */
export interface ChunkResult {
  /** Array of text chunks */
  chunks: TextChunk[];
  /** Total number of chunks */
  totalChunks: number;
  /** Total length of original text */
  originalLength: number;
}

const DEFAULT_MAX_CHUNK_SIZE = 300;
const DEFAULT_MIN_CHUNK_SIZE = 50;

/**
 * Sentence boundary patterns for splitting text
 * Includes Japanese and English sentence terminators
 */
const SENTENCE_BOUNDARIES = /[。！？\.!\?]+[\s\n]*/g;

/**
 * Split long text into chunks suitable for TTS synthesis
 *
 * @param text - The text to split
 * @param config - Configuration options
 * @returns ChunkResult containing the chunks and metadata
 *
 * @example
 * ```typescript
 * const text = "This is a long text. It needs to be split. Into smaller chunks.";
 * const result = chunkText(text, { maxChunkSize: 30 });
 * console.log(result.chunks.length); // 3
 * ```
 */
export function chunkText(text: string, config: ChunkConfig = {}): ChunkResult {
  const maxChunkSize = config.maxChunkSize || DEFAULT_MAX_CHUNK_SIZE;
  const minChunkSize = config.minChunkSize || DEFAULT_MIN_CHUNK_SIZE;

  if (!text || text.trim().length === 0) {
    return {
      chunks: [],
      totalChunks: 0,
      originalLength: 0,
    };
  }

  // If text is shorter than max chunk size, return as single chunk
  if (text.length <= maxChunkSize) {
    return {
      chunks: [
        {
          text,
          startOffset: 0,
          endOffset: text.length,
          index: 0,
        },
      ],
      totalChunks: 1,
      originalLength: text.length,
    };
  }

  // Split text into sentences
  const sentences = splitIntoSentences(text);

  // Group sentences into chunks
  const chunks: TextChunk[] = [];
  let currentChunk = '';
  let currentStartOffset = 0;
  let chunkIndex = 0;

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const potentialChunk = currentChunk + sentence;

    // Check if adding this sentence would exceed max chunk size
    if (potentialChunk.length > maxChunkSize && currentChunk.length >= minChunkSize) {
      // Save current chunk
      chunks.push({
        text: currentChunk,
        startOffset: currentStartOffset,
        endOffset: currentStartOffset + currentChunk.length,
        index: chunkIndex++,
      });

      // Start new chunk with current sentence
      currentStartOffset += currentChunk.length;
      currentChunk = sentence;
    } else {
      // Add sentence to current chunk
      currentChunk = potentialChunk;
    }
  }

  // Add remaining chunk if any
  if (currentChunk.length > 0) {
    chunks.push({
      text: currentChunk,
      startOffset: currentStartOffset,
      endOffset: currentStartOffset + currentChunk.length,
      index: chunkIndex,
    });
  }

  return {
    chunks,
    totalChunks: chunks.length,
    originalLength: text.length,
  };
}

/**
 * Split text into sentences using sentence boundary patterns
 *
 * @param text - Text to split
 * @returns Array of sentences (including their terminators)
 */
function splitIntoSentences(text: string): string[] {
  const sentences: string[] = [];
  let lastIndex = 0;

  // Find all sentence boundaries
  const matches = Array.from(text.matchAll(SENTENCE_BOUNDARIES));

  for (const match of matches) {
    if (match.index !== undefined) {
      const endIndex = match.index + match[0].length;
      const sentence = text.substring(lastIndex, endIndex);
      if (sentence.trim().length > 0) {
        sentences.push(sentence);
      }
      lastIndex = endIndex;
    }
  }

  // Add remaining text if any
  if (lastIndex < text.length) {
    const remaining = text.substring(lastIndex);
    if (remaining.trim().length > 0) {
      sentences.push(remaining);
    }
  }

  return sentences;
}

/**
 * Calculate the total text length from chunks
 * Useful for validation
 *
 * @param chunks - Array of text chunks
 * @returns Total length of all chunk texts combined
 */
export function calculateTotalLength(chunks: TextChunk[]): number {
  return chunks.reduce((total, chunk) => total + chunk.text.length, 0);
}

/**
 * Get chunk at specific character position in original text
 *
 * @param chunks - Array of text chunks
 * @param position - Character position in original text
 * @returns The chunk containing that position, or null if not found
 */
export function getChunkAtPosition(chunks: TextChunk[], position: number): TextChunk | null {
  for (const chunk of chunks) {
    if (position >= chunk.startOffset && position < chunk.endOffset) {
      return chunk;
    }
  }
  return null;
}
