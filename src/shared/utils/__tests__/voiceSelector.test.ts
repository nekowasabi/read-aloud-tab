/**
 * voiceSelectorユーティリティのテストスイート
 * process5: 音声の性別選択機能の実装（ハイブリッド方式）
 */

import {
  isFemaleVoice,
  isMaleVoice,
  filterVoices,
  VoiceFilter,
  getVoiceGender,
  getVoiceQuality,
} from '../voiceSelector';

/**
 * モック SpeechSynthesisVoice のファクトリ
 */
function createMockVoice(
  name: string,
  lang: string,
  local: boolean = true,
  default_: boolean = false
): SpeechSynthesisVoice {
  return {
    name,
    lang,
    localService: local,
    default: default_,
    voiceURI: name,
  } as unknown as SpeechSynthesisVoice;
}

describe('voiceSelector', () => {
  describe('isFemaleVoice', () => {
    it('should detect female voices with explicit "female" keyword', () => {
      expect(isFemaleVoice('Female Voice')).toBe(true);
      expect(isFemaleVoice('female voice en')).toBe(true);
    });

    it('should detect female voices with gender keywords', () => {
      expect(isFemaleVoice('Woman Voice')).toBe(true);
      expect(isFemaleVoice('Girl Voice')).toBe(true);
    });

    it('should detect female voices with Japanese keywords', () => {
      expect(isFemaleVoice('女性音声')).toBe(true);
      expect(isFemaleVoice('女性')).toBe(true);
    });

    it('should detect female voices with known female character names', () => {
      expect(isFemaleVoice('Kyoko')).toBe(true);
      expect(isFemaleVoice('Samantha')).toBe(true);
      expect(isFemaleVoice('Siri')).toBe(true);
    });

    it('should not detect male voices as female', () => {
      expect(isFemaleVoice('Male Voice')).toBe(false);
      expect(isFemaleVoice('Man Voice')).toBe(false);
      expect(isFemaleVoice('Daniel')).toBe(false);
    });

    it('should default to true for unknown voice names', () => {
      expect(isFemaleVoice('Unknown Voice')).toBe(true);
      expect(isFemaleVoice('Generic Voice')).toBe(true);
    });
  });

  describe('isMaleVoice', () => {
    it('should detect male voices with explicit "male" keyword', () => {
      expect(isMaleVoice('Male Voice')).toBe(true);
      expect(isMaleVoice('male voice en')).toBe(true);
    });

    it('should detect male voices with gender keywords', () => {
      expect(isMaleVoice('Man Voice')).toBe(true);
      expect(isMaleVoice('Boy Voice')).toBe(true);
    });

    it('should detect male voices with Japanese keywords', () => {
      expect(isMaleVoice('男性音声')).toBe(true);
      expect(isMaleVoice('男性')).toBe(true);
    });

    it('should detect male voices with known male character names', () => {
      expect(isMaleVoice('Hattori')).toBe(true);
      expect(isMaleVoice('Daniel')).toBe(true);
      expect(isMaleVoice('Thomas')).toBe(true);
    });

    it('should not detect female voices as male', () => {
      expect(isMaleVoice('Female Voice')).toBe(false);
      expect(isMaleVoice('Woman Voice')).toBe(false);
      expect(isMaleVoice('Kyoko')).toBe(false);
    });

    it('should return false for unknown voice names', () => {
      expect(isMaleVoice('Unknown Voice')).toBe(false);
      expect(isMaleVoice('Generic Voice')).toBe(false);
    });
  });

  describe('filterVoices', () => {
    const mockVoices = [
      createMockVoice('Female Voice 1', 'ja-JP'),
      createMockVoice('Male Voice 1', 'ja-JP'),
      createMockVoice('Kyoko', 'ja-JP'),
      createMockVoice('Daniel', 'en-US'),
      createMockVoice('Samantha', 'en-US'),
    ];

    it('should filter by gender=female', () => {
      const filter: VoiceFilter = { gender: 'female' };
      const result = filterVoices(mockVoices, filter);
      expect(result.length).toBe(3); // Female Voice 1, Kyoko, Samantha
      expect(result.every((v) => isFemaleVoice(v.name))).toBe(true);
    });

    it('should filter by gender=male', () => {
      const filter: VoiceFilter = { gender: 'male' };
      const result = filterVoices(mockVoices, filter);
      expect(result.length).toBeGreaterThan(0);
      expect(result.every((v) => isMaleVoice(v.name))).toBe(true);
    });

    it('should filter by language', () => {
      const filter: VoiceFilter = { language: 'ja' };
      const result = filterVoices(mockVoices, filter);
      expect(result.every((v) => v.lang.startsWith('ja'))).toBe(true);
    });

    it('should filter by gender and language combined', () => {
      const filter: VoiceFilter = { gender: 'female', language: 'en' };
      const result = filterVoices(mockVoices, filter);
      expect(result.length).toBeGreaterThan(0);
      result.forEach((v) => {
        expect(isFemaleVoice(v.name)).toBe(true);
        expect(v.lang.startsWith('en')).toBe(true);
      });
    });

    it('should return all voices when no filter is provided', () => {
      const result = filterVoices(mockVoices, {});
      expect(result.length).toBe(mockVoices.length);
    });

    it('should handle empty voice list', () => {
      const result = filterVoices([], { gender: 'female' });
      expect(result.length).toBe(0);
    });
  });

  describe('getVoiceGender', () => {
    it('should return "female" for female voice names', () => {
      expect(getVoiceGender('Female Voice')).toBe('female');
      expect(getVoiceGender('Kyoko')).toBe('female');
    });

    it('should return "male" for male voice names', () => {
      expect(getVoiceGender('Male Voice')).toBe('male');
      expect(getVoiceGender('Daniel')).toBe('male');
    });

    it('should return "unknown" for unknown voices', () => {
      expect(getVoiceGender('Unknown Voice')).toBe('unknown');
    });

    it('should handle case-insensitive matching', () => {
      expect(getVoiceGender('FEMALE VOICE')).toBe('female');
      expect(getVoiceGender('kyoko')).toBe('female');
    });
  });

  describe('getVoiceQuality', () => {
    it('should return "premium" for known premium voices', () => {
      expect(getVoiceQuality('Kyoko', 'ja-JP')).toBe('premium');
    });

    it('should return "standard" for known standard voices', () => {
      expect(getVoiceQuality('Ichiro', 'ja-JP')).toBe('standard');
    });

    it('should return "standard" as default for unknown voices', () => {
      expect(getVoiceQuality('Unknown Voice', 'en-US')).toBe('standard');
    });
  });
});
