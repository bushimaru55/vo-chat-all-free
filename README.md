# vo-chat

Mac 本体へ **追加インストールを行わず**、Docker Compose だけで起動できるローカル AI チャットボットです。

Mac M3 / 16GB 向けの試作を想定していますが、Docker 上では Metal/GPU を十分に活かしにくいため、**CPU 実行・再現性・削除のしやすさ** を優先しています。

## 方針

- **全 Docker 構成**: Node.js / Python / llama.cpp / whisper.cpp はコンテナ内のみ
- **Mac 本体**: Docker / Docker Compose / Homebrew は既存利用可（本プロジェクトでは `brew install` しない）
- **モデル**: ユーザーが `models/` に LLM 用 GGUF + STT 用 whisper モデルを配置

## クイックスタート

```bash
cp .env.example .env
# models/ に LLM(GGUF) と STT(ggml-*.bin) を配置し .env を合わせる
docker compose build
docker compose up
```

ブラウザ: http://localhost:5173

## 必要なモデル

### LLM

```env
LLM_MODEL_PATH=/models/your-model.gguf
```

### STT (whisper.cpp)

```env
STT_MODEL_PATH=/models/ggml-base.bin
```

`models/` 例:

```text
models/
  qwen2.5-0.5b-instruct-q4_k_m.gguf
  ggml-base.bin
```

## 音声入力機能

vo-chat では、ブラウザの MediaRecorder API で録音し、api コンテナ経由で stt コンテナへ送信し、stt コンテナ内の whisper.cpp で文字起こしします。

```text
Browser microphone
  ↓
frontend
  ↓ multipart/form-data
api
  ↓ multipart/form-data
stt (whisper.cpp)
  ↓
text
  ↓
frontend input
```

- 「音声入力」クリックで録音開始
- 「録音停止」で録音終了
- 文字起こし完了後、入力欄に反映（自動送信はしない）
- 最大録音時間: 30 秒

### 推奨 STT モデル

Mac M3 / 16GB / 全Docker構成での推奨:

- 最初に試す: `ggml-base.bin`
- 少し精度を上げる: `ggml-small.bin`
- 重め: `ggml-medium.bin`

非推奨:

- `large-v3`
- `large-v3-turbo`

理由: 全Docker構成では Metal/Core ML を使えない可能性が高く、CPU 実行になるため。

## API 確認

```bash
curl http://localhost:8000/health
curl http://localhost:8000/api/llm/health
curl http://localhost:9000/health
curl http://localhost:8000/api/stt/health
curl http://localhost:8000/api/rag/health
```

音声ファイルで STT テスト:

```bash
curl -X POST http://localhost:8000/api/stt \
  -F "file=@sample.wav"
```

## RAG（ドキュメント検索）

`api` コンテナは `docs/` を `/knowledge` として読み込み、`FastEmbed` で埋め込みを作成して `ChromaDB`（`/rag-data`）に保存します。質問時はベクトル検索したチャンクを LLM に付与します。

- 対象ファイル: `docs/**/*.md`, `docs/**/*.txt`
- 設定:

```env
RAG_ENABLED=true
RAG_DOCUMENTS_DIR=/knowledge
RAG_DB_DIR=/rag-data
RAG_EMBEDDING_MODEL=sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
RAG_TOP_K=3
```

確認用:

```bash
curl http://localhost:8000/api/rag/health
curl "http://localhost:8000/api/rag/search?q=LLM_MODEL_PATH&top_k=3"
```

## Docker Desktop メモリ

LLM/STT はメモリを多く使います。Docker Desktop の Resources で **8GB 以上**（16GB 環境なら 10〜12GB 推奨）を割り当ててください。

## 未実装機能

- リアルタイム逐次音声認識
- 無音検知/VAD
- サーバー側 TTS（`tts` は雛形）
- Mac Metal / GPU による高速推論

## ドキュメント

- [setup.md](docs/setup.md) — 詳細セットアップ
- [architecture.md](docs/architecture.md) — 構成図
- [cleanup.md](docs/cleanup.md) — 削除手順
