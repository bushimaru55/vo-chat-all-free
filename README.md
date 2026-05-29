# vo-chat-all-free

Mac・Windows本体へ **追加インストールを行わず**、Docker Compose だけで起動できるローカル AI チャットボットです。
サーバーへの展開ももちろん可能です。（スペック用確認）
とにかくお金をかけずにAI音声チャットボットを作るというテーマで開発してます・・・・

- リポジトリ: https://github.com/bushimaru55/vo-chat-all-free
- チャット UI: http://localhost:5173
- 管理画面: http://localhost:5173/admin （ログイン: `admin` / `admin`）

Mac M3 / 16GB 向けの試作を想定しています。Docker 上では Metal/GPU を十分に活かしにくいため、**CPU 実行・再現性・削除のしやすさ** を優先しています。

## 主な機能

| 機能 | 説明 |
|------|------|
| テキストチャット | llama.cpp 上の LLM で日本語応答 |
| 音声入力 | whisper.cpp による文字起こし（base / small / medium 選択可） |
| 音声会話モード | VAD による無音検知・自動送信 |
| RAG | ChromaDB + FastEmbed による学習データ検索付き回答 |
| 管理画面 | 学習データのアップロード・URL/XML 取込・Embedding 作成・プレビュー |

## 方針

- **全 Docker 構成**: Node.js / Python / llama.cpp / whisper.cpp はコンテナ内のみ
- **Mac 本体**: Docker / Docker Compose / Homebrew は既存利用可（本プロジェクトでは `brew install` しない）
- **モデル**: ユーザーが `models/` に LLM 用 GGUF + STT 用 whisper モデルを配置

## クイックスタート

```bash
git clone https://github.com/bushimaru55/vo-chat-all-free.git
cd vo-chat-all-free

cp .env.example .env
# models/ に LLM(GGUF) と STT(ggml-*.bin) を配置し .env を合わせる

docker compose build
docker compose up
```

ブラウザで http://localhost:5173 を開きます。

## 必要なモデル

### LLM

```env
LLM_MODEL_PATH=/models/your-model.gguf
```

例: `qwen2.5-0.5b-instruct-q4_k_m.gguf`

### STT (whisper.cpp)

```env
STT_MODEL_PATH=/models/ggml-base.bin
```

`models/` 配置例:

```text
models/
  qwen2.5-0.5b-instruct-q4_k_m.gguf
  ggml-base.bin
  ggml-small.bin
  ggml-medium.bin
```

## 音声入力

```text
Browser microphone
  ↓ MediaRecorder
frontend
  ↓ multipart/form-data
api
  ↓ multipart/form-data
stt (whisper.cpp)
  ↓ text
frontend
```

- 「音声入力」で録音開始 → 「音声停止」で終了
- 音声会話モード: 2 秒以上無音で自動文字起こし・送信
- STT モデルは UI から base / small / medium を選択可能

## RAG（学習データ検索）

`api` コンテナは以下を学習ソースとして読み込み、ベクトル検索結果を LLM プロンプトに付与して回答します。

- `docs/` … 初期ナレッジ（読み取り専用）
- `rag-uploads/` … 管理画面から追加したファイル

### 管理画面での操作

1. http://localhost:5173/admin にアクセス（`admin` / `admin`）
2. 学習データを追加
   - **ファイル**: `.md`, `.txt`, `.pdf`, `.pptx`
   - **URL**: Web ページをスクレイピング
   - **サイトマップ XML**: 複数 URL を一括取得
3. **学習データを作成** をクリックして Embedding（インデックス）を生成
4. 各ドキュメントの **学習済み / 未学習** ステータスを確認
5. **確認** ボタンで抽出テキストをモーダルプレビュー

### 環境変数

```env
RAG_ENABLED=true
RAG_DOCUMENTS_DIR=/knowledge
RAG_UPLOADS_DIR=/rag-uploads
RAG_DB_DIR=/rag-data
RAG_EMBEDDING_MODEL=sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
RAG_TOP_K=3
```

### 確認用 API

```bash
curl http://localhost:8000/api/rag/health
curl http://localhost:8000/api/rag/documents
curl "http://localhost:8000/api/rag/search?q=機能について&top_k=3"
```

## 開発時のメモ

フロントエンドは `docker-compose.yml` でソースをボリュームマウントしており、`frontend/src/` の変更は Vite HMR で即反映されます。

```yaml
volumes:
  - ./frontend/src:/app/src
  - ./frontend/index.html:/app/index.html
  - ./frontend/vite.config.ts:/app/vite.config.ts
  - ./frontend/tsconfig.json:/app/tsconfig.json
```

API の変更を反映する場合:

```bash
docker compose up -d --build api
```

## API ヘルスチェック

```bash
curl http://localhost:8000/health
curl http://localhost:8000/api/llm/health
curl http://localhost:8000/api/stt/health
curl http://localhost:8000/api/rag/health
```

## Docker Desktop メモリ

LLM/STT はメモリを多く使います。Docker Desktop の Resources で **8GB 以上**（16GB 環境なら 10〜12GB 推奨）を割り当ててください。

## ディレクトリ構成

```text
vo-chat-all-free/
├── api/           # FastAPI（チャット・STT プロキシ・RAG）
├── frontend/      # React + Vite
├── llm/           # llama.cpp サーバー
├── stt/           # whisper.cpp サーバー
├── docs/          # 初期ナレッジ
├── rag-uploads/   # 管理画面から追加した学習データ（gitignore）
├── rag-data/      # ChromaDB インデックス（gitignore）
├── models/        # LLM / STT モデル（gitignore、.gitkeep のみ）
└── docker-compose.yml
```

## 未実装・制限事項

- サーバー側 TTS（`tts` は雛形。ブラウザ `speechSynthesis` を使用）
- Mac Metal / GPU による高速推論
- 小型 LLM（0.5B 等）利用時は RAG 回答の繰り返しや言い換えミスが起きる場合あり

## 関連ドキュメント

- [docs/setup.md](docs/setup.md) — 詳細セットアップ
- [docs/architecture.md](docs/architecture.md) — 構成図
- [docs/cleanup.md](docs/cleanup.md) — 削除手順

## ライセンス

本リポジトリの利用条件はリポジトリオーナーに従ってください。
