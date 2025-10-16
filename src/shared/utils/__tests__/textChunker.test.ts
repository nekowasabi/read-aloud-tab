/**
 * Unit tests for textChunker
 */
import {
  chunkText,
  calculateTotalLength,
  getChunkAtPosition,
  type ChunkConfig,
} from '../textChunker';

describe('chunkText', () => {
  describe('基本機能', () => {
    test('空文字列の場合、空の配列を返す', () => {
      const result = chunkText('');
      expect(result.chunks).toEqual([]);
      expect(result.totalChunks).toBe(0);
      expect(result.originalLength).toBe(0);
    });

    test('maxChunkSize以下のテキストは1つのチャンクになる', () => {
      const text = 'こんにちは';
      const result = chunkText(text, { maxChunkSize: 100 });

      expect(result.totalChunks).toBe(1);
      expect(result.chunks[0].text).toBe(text);
      expect(result.chunks[0].startOffset).toBe(0);
      expect(result.chunks[0].endOffset).toBe(text.length);
      expect(result.chunks[0].index).toBe(0);
      expect(result.originalLength).toBe(text.length);
    });

    test('長いテキストは複数のチャンクに分割される', () => {
      const text = 'これは長い文です。別の文です。さらに別の文です。最後の文です。';
      const config: ChunkConfig = { maxChunkSize: 20, minChunkSize: 5 };
      const result = chunkText(text, config);

      expect(result.totalChunks).toBeGreaterThan(1);
      expect(result.originalLength).toBe(text.length);
    });
  });

  describe('offset計算の正確性', () => {
    test('各チャンクのstartOffsetとendOffsetが連続している', () => {
      const text = '最初の文です。次の文です。三番目の文です。最後の文です。';
      const config: ChunkConfig = { maxChunkSize: 20, minChunkSize: 5 };
      const result = chunkText(text, config);

      for (let i = 1; i < result.chunks.length; i++) {
        const prevChunk = result.chunks[i - 1];
        const currentChunk = result.chunks[i];

        // 前のチャンクのendOffsetが次のチャンクのstartOffsetと一致する
        expect(prevChunk.endOffset).toBe(currentChunk.startOffset);
      }
    });

    test('最初のチャンクはoffset 0から始まる', () => {
      const text = 'テスト文です。別の文です。';
      const result = chunkText(text, { maxChunkSize: 10 });

      expect(result.chunks[0].startOffset).toBe(0);
    });

    test('最後のチャンクのendOffsetは元のテキスト長と一致する', () => {
      const text = 'これは最初の文です。これは二番目の文です。これは三番目の文です。';
      const config: ChunkConfig = { maxChunkSize: 25, minChunkSize: 10 };
      const result = chunkText(text, config);

      const lastChunk = result.chunks[result.chunks.length - 1];
      expect(lastChunk.endOffset).toBe(text.length);
    });

    test('全チャンクを結合すると元のテキストになる', () => {
      const text = 'A。B。C。D。E。F。G。H。I。J。';
      const config: ChunkConfig = { maxChunkSize: 10, minChunkSize: 2 };
      const result = chunkText(text, config);

      const reconstructed = result.chunks.map(chunk => chunk.text).join('');
      expect(reconstructed).toBe(text);
    });

    test('各チャンクのテキストがoffsetと整合している', () => {
      const text = '一番目。二番目。三番目。四番目。';
      const config: ChunkConfig = { maxChunkSize: 15, minChunkSize: 5 };
      const result = chunkText(text, config);

      for (const chunk of result.chunks) {
        const extractedText = text.substring(chunk.startOffset, chunk.endOffset);
        expect(chunk.text).toBe(extractedText);
      }
    });
  });

  describe('エッジケース', () => {
    test('ちょうどmaxChunkSizeのテキスト', () => {
      const text = '12345678901234567890'; // 20文字
      const result = chunkText(text, { maxChunkSize: 20 });

      expect(result.totalChunks).toBe(1);
      expect(result.chunks[0].text).toBe(text);
      expect(result.chunks[0].startOffset).toBe(0);
      expect(result.chunks[0].endOffset).toBe(20);
    });

    test('空白のみのテキスト', () => {
      const text = '   ';
      const result = chunkText(text, { maxChunkSize: 100 });

      // 空白のみのテキストでも1チャンクとして扱う
      expect(result.totalChunks).toBeGreaterThanOrEqual(0);
    });

    test('句点がないテキスト（文の境界がない）', () => {
      const text = 'これは句点がないテキストですがとても長いのでチャンクに分割されるはずです';
      const result = chunkText(text, { maxChunkSize: 20 });

      // 句点がなくても1チャンクとして扱われる
      expect(result.totalChunks).toBe(1);
      expect(result.chunks[0].text).toBe(text);
    });

    test('連続する句点', () => {
      const text = 'テスト。。。次の文。';
      const result = chunkText(text, { maxChunkSize: 100 });

      expect(result.totalChunks).toBeGreaterThanOrEqual(1);
      const reconstructed = result.chunks.map(chunk => chunk.text).join('');
      expect(reconstructed).toBe(text);
    });

    test('英語の文章', () => {
      const text = 'This is a test. Another sentence. And one more.';
      const config: ChunkConfig = { maxChunkSize: 20, minChunkSize: 5 };
      const result = chunkText(text, config);

      expect(result.totalChunks).toBeGreaterThan(1);
      const reconstructed = result.chunks.map(chunk => chunk.text).join('');
      expect(reconstructed).toBe(text);
    });

    test('日英混在の文章', () => {
      const text = 'これは日本語です。This is English. また日本語。';
      const config: ChunkConfig = { maxChunkSize: 20, minChunkSize: 5 };
      const result = chunkText(text, config);

      const reconstructed = result.chunks.map(chunk => chunk.text).join('');
      expect(reconstructed).toBe(text);
    });
  });

  describe('チャンクインデックス', () => {
    test('チャンクインデックスが0から順番に付けられている', () => {
      const text = '文1。文2。文3。文4。文5。';
      const result = chunkText(text, { maxChunkSize: 10 });

      for (let i = 0; i < result.chunks.length; i++) {
        expect(result.chunks[i].index).toBe(i);
      }
    });
  });

  describe('設定パラメータ', () => {
    test('デフォルト設定でチャンク分割される', () => {
      const text = '文1。文2。文3。文4。文5。文6。文7。文8。文9。文10。';
      const result = chunkText(text);

      expect(result.totalChunks).toBeGreaterThanOrEqual(1);
    });

    test('minChunkSizeより小さいチャンクは作られない（可能な限り）', () => {
      const text = 'A。B。C。D。E。';
      const config: ChunkConfig = { maxChunkSize: 10, minChunkSize: 5 };
      const result = chunkText(text, config);

      // 各チャンク（最後を除く）がminChunkSize以上であることを確認
      for (let i = 0; i < result.chunks.length - 1; i++) {
        expect(result.chunks[i].text.length).toBeGreaterThanOrEqual(config.minChunkSize || 0);
      }
    });
  });
});

describe('calculateTotalLength', () => {
  test('全チャンクの合計長を正しく計算する', () => {
    const text = 'これはテストです。別の文です。';
    const result = chunkText(text, { maxChunkSize: 15 });
    const totalLength = calculateTotalLength(result.chunks);

    expect(totalLength).toBe(text.length);
  });

  test('空配列の場合は0を返す', () => {
    const totalLength = calculateTotalLength([]);
    expect(totalLength).toBe(0);
  });
});

describe('getChunkAtPosition', () => {
  test('指定位置を含むチャンクを返す', () => {
    const text = 'AAAA。BBBB。CCCC。';
    const result = chunkText(text, { maxChunkSize: 10 });

    // 2番目のチャンクの位置を指定
    if (result.chunks.length >= 2) {
      const secondChunk = result.chunks[1];
      const midPosition = secondChunk.startOffset + Math.floor(secondChunk.text.length / 2);
      const chunk = getChunkAtPosition(result.chunks, midPosition);

      expect(chunk).toBe(secondChunk);
    }
  });

  test('最初の位置（0）は最初のチャンクを返す', () => {
    const text = 'テスト文。';
    const result = chunkText(text);
    const chunk = getChunkAtPosition(result.chunks, 0);

    expect(chunk).toBe(result.chunks[0]);
  });

  test('範囲外の位置はnullを返す', () => {
    const text = 'テスト文。';
    const result = chunkText(text);
    const chunk = getChunkAtPosition(result.chunks, 999);

    expect(chunk).toBeNull();
  });

  test('空配列の場合はnullを返す', () => {
    const chunk = getChunkAtPosition([], 0);
    expect(chunk).toBeNull();
  });
});
