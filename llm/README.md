# LLM Container

`llama.cpp` の `llama-server` を Docker 内でビルドし、OpenAI 互換 API を提供します。

## モデル

ホストの `models/` を `/models` に read-only マウントします。`.env` の `LLM_MODEL_PATH` で GGUF ファイルを指定してください。

## 注意

- Mac Docker では Metal/GPU を十分に活用できないため、CPU 実行前提です。
- 初回ビルドは `llama.cpp` のコンパイルのため時間がかかります。
- モデル読み込み完了まで API からの接続が失敗する場合があります。
