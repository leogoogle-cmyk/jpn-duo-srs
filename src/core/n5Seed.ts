// src/core/n5Seed.ts
// ---------------------------------------------------------------------------
// N5 驗證種子題庫（含 word 與 sentence 兩種題型）。
// ⚠️ pitchAccent 為東京標準語「參考值」，正式內容請以權威辭典校對。
// ---------------------------------------------------------------------------
import type { Card } from './types';

export const N5_SEED_CARDS: Card[] = [
  // ---- 題型 A：單字 ----
  { id: 'n5-word-0001', word: '昨日', reading: 'きのう', meaning: '昨天', romaji: 'kinou', type: 'word', pitchAccent: '⓪', level: 'N5', tags: ['名詞', '時間'] },
  { id: 'n5-word-0002', word: '私', reading: 'わたし', meaning: '我', romaji: 'watashi', type: 'word', pitchAccent: '⓪', level: 'N5', tags: ['代名詞'] },
  { id: 'n5-word-0003', word: '学生', reading: 'がくせい', meaning: '學生', romaji: 'gakusei', type: 'word', pitchAccent: '⓪', level: 'N5', tags: ['名詞'] },
  { id: 'n5-word-0004', word: '先生', reading: 'せんせい', meaning: '老師', romaji: 'sensei', type: 'word', pitchAccent: '①', level: 'N5', tags: ['名詞'] },
  { id: 'n5-word-0005', word: '食べる', reading: 'たべる', meaning: '吃', romaji: 'taberu', type: 'word', pitchAccent: '②', level: 'N5', tags: ['動詞', '一段'] },
  { id: 'n5-word-0006', word: '飲む', reading: 'のむ', meaning: '喝', romaji: 'nomu', type: 'word', pitchAccent: '①', level: 'N5', tags: ['動詞', '五段'] },
  { id: 'n5-word-0007', word: '行く', reading: 'いく', meaning: '去', romaji: 'iku', type: 'word', pitchAccent: '⓪', level: 'N5', tags: ['動詞', '五段'] },
  { id: 'n5-word-0008', word: '水', reading: 'みず', meaning: '水', romaji: 'mizu', type: 'word', pitchAccent: '⓪', level: 'N5', tags: ['名詞'] },
  { id: 'n5-word-0009', word: '大きい', reading: 'おおきい', meaning: '大的', romaji: 'ookii', type: 'word', pitchAccent: '③', level: 'N5', tags: ['形容詞', 'い'] },
  { id: 'n5-word-0010', word: 'コンビニ', reading: 'コンビニ', meaning: '便利商店', romaji: 'konbini', type: 'word', pitchAccent: '⓪', level: 'N5', tags: ['名詞', '外來語'] },

  // ---- 題型 B：句子（附預設語塊 tiles）----
  { id: 'n5-sentence-0001', word: 'これは猫です。', reading: 'これはねこです。', meaning: '這是貓。', romaji: 'kore wa neko desu', type: 'sentence', tiles: ['これ', 'は', '猫', 'です', '。'], level: 'N5', tags: ['句型'] },
  { id: 'n5-sentence-0002', word: '私は学生です。', reading: 'わたしはがくせいです。', meaning: '我是學生。', romaji: 'watashi wa gakusei desu', type: 'sentence', tiles: ['私', 'は', '学生', 'です', '。'], level: 'N5', tags: ['句型'] },
  { id: 'n5-sentence-0003', word: '水を飲みます。', reading: 'みずをのみます。', meaning: '喝水。', romaji: 'mizu o nomimasu', type: 'sentence', tiles: ['水', 'を', '飲み', 'ます', '。'], level: 'N5', tags: ['句型'] },
];
