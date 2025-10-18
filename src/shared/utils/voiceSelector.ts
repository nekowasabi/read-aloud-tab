/**
 * voiceSelectorユーティリティ
 * process5: 音声の性別選択機能の実装（ハイブリッド方式）
 *
 * 機能:
 * - 音声の性別推測（パターンマッチング）
 * - JSON定義からのメタデータ参照
 * - 性別ベースの音声フィルタリング
 * - 音声品質の取得
 */

import voiceMetadata from '../data/voiceMetadata.json';

/**
 * 音声フィルタリング条件
 */
export interface VoiceFilter {
  gender?: 'female' | 'male' | 'any';
  language?: string;
  quality?: 'premium' | 'standard';
}

/**
 * 音声メタデータの型定義
 */
export interface VoiceMetadataEntry {
  name: string;
  gender: 'female' | 'male' | 'unknown';
  quality: 'premium' | 'standard';
}

/**
 * 女性キーワードリスト
 */
const FEMALE_KEYWORDS = [
  'female',
  'woman',
  'girl',
  '女性',
  'kyoko',
  'samantha',
  'siri',
  'victoria',
  'moira',
  'karen',
  'zira',
  'ayumi',
  'victoria',
];

/**
 * 男性キーワードリスト
 */
const MALE_KEYWORDS = [
  'male',
  'man',
  'boy',
  '男性',
  'hattori',
  'daniel',
  'thomas',
  'david',
  'mark',
  'ichiro',
  'haruka',
];

/**
 * 音声名から女性音声かどうかを推測
 * @param voiceName 音声名
 * @returns 女性音声と判定された場合 true
 */
export function isFemaleVoice(voiceName: string): boolean {
  const lowerName = voiceName.toLowerCase();

  // 女性キーワードを優先的に確認
  const hasFemaleKeyword = FEMALE_KEYWORDS.some((keyword) =>
    lowerName.includes(keyword)
  );

  if (hasFemaleKeyword) {
    // 女性キーワードがある場合は female を返す
    // （'woman'に'man'が含まれるのを回避）
    return true;
  }

  // 男性キーワードが含まれている場合は false
  if (MALE_KEYWORDS.some((keyword) => lowerName.includes(keyword))) {
    return false;
  }

  // デフォルト: 女性音声と判定（女性を優先）
  return true;
}

/**
 * 音声名から男性音声かどうかを推測
 * @param voiceName 音声名
 * @returns 男性音声と判定された場合 true
 */
export function isMaleVoice(voiceName: string): boolean {
  const lowerName = voiceName.toLowerCase();

  // 女性キーワードが含まれている場合は false
  if (FEMALE_KEYWORDS.some((keyword) => lowerName.includes(keyword))) {
    return false;
  }

  // 男性キーワードが含まれている場合は true
  if (MALE_KEYWORDS.some((keyword) => lowerName.includes(keyword))) {
    return true;
  }

  return false;
}

/**
 * 音声のメタデータをJSON定義から取得
 * @param voiceName 音声名
 * @param lang 言語コード（例: "ja-JP"）
 * @returns メタデータエントリ、見つからない場合は undefined
 */
export function getVoiceMetadata(
  voiceName: string,
  lang: string
): VoiceMetadataEntry | undefined {
  // 言語コードから音声リストを取得
  const langMetadata = (
    voiceMetadata as Record<string, VoiceMetadataEntry[]>
  )[lang];

  if (!langMetadata) {
    return undefined;
  }

  // 音声名から完全一致または部分一致でメタデータを検索
  return langMetadata.find((entry) => {
    const entryNameLower = entry.name.toLowerCase();
    const voiceNameLower = voiceName.toLowerCase();
    return (
      entryNameLower === voiceNameLower ||
      voiceNameLower.includes(entryNameLower)
    );
  });
}

/**
 * 音声の性別を取得（ハイブリッド方式）
 * @param voiceName 音声名
 * @param lang 言語コード（オプション）
 * @returns 'female' | 'male' | 'unknown'
 */
export function getVoiceGender(
  voiceName: string,
  lang?: string
): 'female' | 'male' | 'unknown' {
  const lowerName = voiceName.toLowerCase();

  // ステップ1: JSON定義から検索
  if (lang) {
    const metadata = getVoiceMetadata(voiceName, lang);
    if (metadata) {
      return metadata.gender;
    }
  }

  // ステップ2: パターンマッチング（明示的なキーワードのみ）
  // 短いキーワードの完全一致や女性/男性キーワードの優先度を考慮
  const hasFemaleKeyword = FEMALE_KEYWORDS.some((keyword) =>
    lowerName.includes(keyword)
  );
  const hasMaleKeyword = MALE_KEYWORDS.some((keyword) =>
    lowerName.includes(keyword)
  );

  // どちらかのキーワードを持つ場合
  if (hasFemaleKeyword || hasMaleKeyword) {
    // 両方のキーワードを持つ場合は、より具体的なキーワードを優先
    if (hasFemaleKeyword && hasMaleKeyword) {
      // 'male' vs 'female'で'female'を優先
      if (lowerName.includes('female')) {
        return 'female';
      }
      if (lowerName.includes('male')) {
        return 'male';
      }
    }
    return hasFemaleKeyword ? 'female' : 'male';
  }

  // ステップ3: デフォルト値
  return 'unknown';
}

/**
 * 音声の品質を取得
 * @param voiceName 音声名
 * @param lang 言語コード（オプション）
 * @returns 'premium' | 'standard'
 */
export function getVoiceQuality(
  voiceName: string,
  lang?: string
): 'premium' | 'standard' {
  // JSON定義から検索
  if (lang) {
    const metadata = getVoiceMetadata(voiceName, lang);
    if (metadata) {
      return metadata.quality;
    }
  }

  // デフォルト値
  return 'standard';
}

/**
 * 音声リストをフィルタリング
 * @param voices 音声リスト
 * @param filter フィルター条件
 * @returns フィルター済みの音声リスト
 */
export function filterVoices(
  voices: SpeechSynthesisVoice[],
  filter: VoiceFilter
): SpeechSynthesisVoice[] {
  return voices.filter((voice) => {
    // 言語フィルター
    if (filter.language) {
      const lang = filter.language.toLowerCase();
      if (!voice.lang.toLowerCase().startsWith(lang)) {
        return false;
      }
    }

    // 性別フィルター
    if (filter.gender && filter.gender !== 'any') {
      if (filter.gender === 'female' && !isFemaleVoice(voice.name)) {
        return false;
      }
      if (filter.gender === 'male' && !isMaleVoice(voice.name)) {
        return false;
      }
    }

    // 品質フィルター
    if (filter.quality) {
      const voiceQuality = getVoiceQuality(voice.name, voice.lang);
      if (voiceQuality !== filter.quality) {
        return false;
      }
    }

    return true;
  });
}

/**
 * 最適な音声を選択（ハイブリッド方式）
 * @param voices 音声リスト
 * @param preferredGender 優先性別（'female' | 'male' | 'any'）
 * @param preferredLanguage 優先言語（例: 'ja'）
 * @returns 選択された音声、見つからない場合は最初の音声
 */
export function selectBestVoice(
  voices: SpeechSynthesisVoice[],
  preferredGender: 'female' | 'male' | 'any' = 'any',
  preferredLanguage: string = 'ja'
): SpeechSynthesisVoice | undefined {
  if (voices.length === 0) {
    return undefined;
  }

  // 言語フィルター
  const langFiltered = filterVoices(voices, { language: preferredLanguage });

  // 性別フィルター（指定されている場合）
  let candidateVoices = langFiltered;
  if (preferredGender !== 'any') {
    const genderFiltered = filterVoices(langFiltered, { gender: preferredGender });
    if (genderFiltered.length > 0) {
      candidateVoices = genderFiltered;
    }
  }

  // 品質優先順位（premium > standard）
  const premiumVoice = candidateVoices.find(
    (v) => getVoiceQuality(v.name, v.lang) === 'premium'
  );
  if (premiumVoice) {
    return premiumVoice;
  }

  // ローカル音声を優先
  const localVoice = candidateVoices.find((v) => v.localService);
  if (localVoice) {
    return localVoice;
  }

  // デフォルト値：フィルター済みリストの最初の音声
  return candidateVoices.length > 0 ? candidateVoices[0] : voices[0];
}

/**
 * 日本語音声をすべて取得
 * @param voices 音声リスト
 * @returns 日本語音声のリスト
 */
export function getJapaneseVoices(
  voices: SpeechSynthesisVoice[]
): SpeechSynthesisVoice[] {
  return filterVoices(voices, { language: 'ja' });
}
