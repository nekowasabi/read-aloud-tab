# Read Aloud Tab

ブラウザのタブコンテンツを音声で読み上げるChrome/Firefox拡張機能

## 特徴

- 🗣️ Web Speech API による高品質な音声合成
- 📱 直感的でモダンなポップアップUI
- ⚙️ 詳細な音声設定（速度、音量、音の高さ、音声選択）
- 🔄 再生、一時停止、停止の完全制御
- 📊 リアルタイムの読み上げ進捗表示
- 🌐 Chrome（Manifest V3）と Firefox（WebExtensions）の両方をサポート
- 🎯 スマートなコンテンツ抽出（記事、メインコンテンツの自動検出）

## 必要要件

- OpenRouter の API トークン（要約/翻訳機能を利用する場合）

## インストール方法

### 開発版

1. 依存関係をインストール
```bash
npm install
```

2. 拡張機能をビルド
```bash
# Chrome用
npm run build:chrome

# Firefox用
npm run build:firefox
```

3. ブラウザに拡張機能を読み込み

#### Chrome の場合:
- `chrome://extensions/` を開く
- 「デベロッパーモード」を有効にする
- 「パッケージ化されていない拡張機能を読み込む」をクリック
- `dist/chrome` フォルダを選択

#### Firefox の場合:
- `about:debugging` を開く
- 「このFirefox」を選択
- 「一時的なアドオンを読み込む」をクリック
- `dist/firefox/manifest.json` を選択

## 使い方

1. 読み上げたいWebページを開く
2. 拡張機能アイコンをクリックしてポップアップを開く
3. 「読み上げ開始」ボタンをクリック
4. 必要に応じて一時停止、再開、停止を操作
5. 設定ボタン（⚙️）から音声設定をカスタマイズ

## 開発

### 開発環境のセットアップ

```bash
# 依存関係のインストール
npm install

# 開発ビルド（ファイル監視付き）
npm run dev

# 型チェック
npm run typecheck

# リント
npm run lint

# フォーマット
npm run format

# テスト実行
npm run test
```

### 技術スタック

- **言語**: TypeScript 5.x
- **ビルドツール**: Webpack 5
- **UI Framework**: React 18
- **音声合成**: Web Speech API
- **テスト**: Jest + React Testing Library

## ライセンス

MIT License