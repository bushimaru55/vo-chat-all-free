# STT Container

このコンテナは `whisper.cpp` を Docker 内でビルドし、HTTP API (`/transcribe`) で音声文字起こしを提供します。

## API

- `GET /health`
- `POST /transcribe` (multipart/form-data)
  - `file`: 音声ファイル
  - `language`: 言語コード（例: `ja`）

## モデル

`models/` を `/models` にマウントし、`.env` の `STT_MODEL_PATH` で指定します。

推奨:

- `ggml-base.bin`（最初に試す）
- `ggml-small.bin`（精度を上げる）
- `ggml-medium.bin`（重い）

全Docker構成では CPU 実行前提になるため、`large-v3` 系は初期検証では非推奨です。
