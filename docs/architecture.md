# vo-chat アーキテクチャ

## 現在の構成

```text
Browser
  ↓
frontend container (React + Vite)
  ↓ HTTP (localhost:8000)
api container (FastAPI)
  ↓ HTTP (llm:8080, Docker network)
llm container (llama-server)
  ↓ read-only volume
models/ (GGUF + whisper model on host)
```

## 音声入力の流れ

```text
Browser microphone
  ↓
MediaRecorder
  ↓
frontend container
  ↓ multipart/form-data
api container
  ↓ multipart/form-data
stt container
  ↓
ffmpeg
  ↓
whisper.cpp
  ↓
文字起こし結果
  ↓
api container
  ↓
frontend container
  ↓
チャット入力欄に反映
```

## 設計方針

- **Mac本体に追加インストールしない。** Node.js / Python / llama.cpp / whisper.cpp はコンテナ内。
- **AI推論・音声認識も Docker 内で行う。**
- **Mac M3 の Metal/GPU 活用より、再現性と削除しやすさを優先する。**
- `api` → `llm`: `http://llm:8080/v1/chat/completions`
- `api` → `stt`: `http://stt:9000/transcribe`
- `host.docker.internal` は使用しない。

## ポート

| サービス | ホストポート | 用途 |
|---|---:|---|
| frontend | 5173 | Web UI |
| api | 8000 | REST API |
| llm | 8080 | llama-server |
| stt | 9000 | whisper.cpp STT API |
