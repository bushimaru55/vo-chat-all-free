# vo-chat セットアップ手順

## 1. vo-chat ディレクトリを作成

本リポジトリを任意の場所に配置します（例: `~/Develop/vo-chat`）。

## 2. .env.example を .env にコピー

```bash
cp .env.example .env
```

## 3. LLM用GGUFモデルを models/ に配置

```text
models/qwen2.5-0.5b-instruct-q4_k_m.gguf
```

## 4. whisper.cpp用モデルを models/ に配置

```text
models/ggml-base.bin
```

## 5. .env の LLM_MODEL_PATH と STT_MODEL_PATH を確認

```env
LLM_MODEL_PATH=/models/qwen2.5-0.5b-instruct-q4_k_m.gguf
STT_MODEL_PATH=/models/ggml-base.bin
```

## 6. Docker Compose でビルド

```bash
docker compose build
```

初回は `llm` と `stt` イメージで `llama.cpp` と `whisper.cpp` をコンパイルするため、時間がかかります。

## 7. Docker Compose で起動

```bash
docker compose up
```

## 8. ブラウザでアクセス

http://localhost:5173

## 9. 音声入力ボタンで録音テスト

1. 「音声入力」をクリックして録音開始
2. もう一度クリックして停止
3. 文字起こし結果が入力欄に入ることを確認
4. 内容確認後に送信

## 10. ヘルスチェックと STT 疎通確認

```bash
curl http://localhost:8000/health
curl http://localhost:8000/api/llm/health
curl http://localhost:9000/health
curl http://localhost:8000/api/stt/health

curl -X POST http://localhost:8000/api/stt \
  -F "file=@sample.wav"
```

## よくあるエラーと対処

### モデルファイルが見つからない

- LLM: `.env` の `LLM_MODEL_PATH` と `models/*.gguf` の一致を確認
- STT: `.env` の `STT_MODEL_PATH` と `models/ggml-*.bin` の一致を確認
- `docker compose logs llm stt` を確認

### llm / stt コンテナの起動が遅い

- 初回ビルド・モデル読み込みは時間がかかる
- `curl` ヘルスチェックを数十秒〜数分待って再実行

### API から STT に接続できない

- `docker compose ps` で `stt` が `Up` か確認
- `docker compose logs stt` で `STT model file not found` などを確認

### マイク権限がない

- ブラウザのマイク権限を許可
- `http://localhost:5173` でアクセスしていることを確認

### ffmpeg変換に失敗

- `stt` ログの `Audio conversion failed.` を確認
- 音声ファイル形式や破損を確認

### whisper.cpp実行に失敗

- `stt` ログの `Transcription failed.` を確認
- まず `ggml-base.bin` で再試行

### タイムアウト

- 録音時間を短くする（最大30秒）
- より軽量なモデル（base）を使う
