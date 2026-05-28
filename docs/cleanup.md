# vo-chat 環境削除

## プロジェクトごと削除

```bash
cd vo-chat
docker compose down --rmi local --volumes --remove-orphans
rm -rf tmp
cd ..
rm -rf vo-chat
```

`models/` 内のモデル（GGUF / ggml）も一緒に削除されます。モデルだけ残す場合は事前に退避してください。

## Docker の未使用データ削除（任意）

```bash
docker system prune
docker builder prune
```

## 強めの削除（注意）

```bash
docker system prune -a --volumes
```

他プロジェクトの未使用イメージやボリュームも削除される可能性があります。
