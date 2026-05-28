from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path

import chromadb
from fastembed import TextEmbedding

_TEXT_FILE_PATTERNS = ("*.md", "*.txt")


@dataclass
class Chunk:
    source: str
    text: str
    score: float


class RagStore:
    def __init__(
        self,
        docs_dirs: list[str],
        db_dir: str,
        embedding_model: str,
        chunk_size: int = 500,
        chunk_overlap: int = 100,
    ) -> None:
        self.docs_dirs = [Path(d) for d in docs_dirs]
        self.db_dir = Path(db_dir)
        self.db_dir.mkdir(parents=True, exist_ok=True)
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.embedding = TextEmbedding(model_name=embedding_model)
        self.client = chromadb.PersistentClient(path=str(self.db_dir))
        self.collection = self.client.get_or_create_collection("vochat_docs")
        self.state_path = self.db_dir / "index_state.json"

    def _chunk_text(self, text: str) -> list[str]:
        content = re.sub(r"\n{3,}", "\n\n", text.strip())
        if not content:
            return []
        chunks: list[str] = []
        step = max(1, self.chunk_size - self.chunk_overlap)
        for start in range(0, len(content), step):
            piece = content[start : start + self.chunk_size].strip()
            if piece:
                chunks.append(piece)
            if start + self.chunk_size >= len(content):
                break
        return chunks

    def _read_documents(self) -> list[tuple[Path, str, Path]]:
        docs: list[tuple[Path, str, Path]] = []
        for docs_dir in self.docs_dirs:
            if not docs_dir.exists():
                continue
            files: list[Path] = []
            for pattern in _TEXT_FILE_PATTERNS:
                files.extend(docs_dir.rglob(pattern))
            for path in sorted(files):
                try:
                    docs.append((path, path.read_text(encoding="utf-8", errors="ignore"), docs_dir))
                except OSError:
                    continue
        return docs

    def _signature(self, docs: list[tuple[Path, str, Path]]) -> str:
        payload = []
        for path, _, _ in docs:
            stat = path.stat()
            payload.append(f"{path}:{stat.st_mtime_ns}:{stat.st_size}")
        joined = "|".join(payload)
        return hashlib.sha256(joined.encode("utf-8")).hexdigest()

    def _load_indexed_signature(self) -> str | None:
        if not self.state_path.exists():
            return None
        try:
            data = json.loads(self.state_path.read_text(encoding="utf-8"))
            return str(data.get("signature"))
        except (OSError, ValueError, TypeError):
            return None

    def _save_indexed_signature(self, signature: str) -> None:
        self.state_path.write_text(json.dumps({"signature": signature}), encoding="utf-8")

    def refresh_if_needed(self) -> None:
        docs = self._read_documents()
        signature = self._signature(docs)
        if signature == self._load_indexed_signature():
            return

        ids: list[str] = []
        metadatas: list[dict[str, str]] = []
        documents: list[str] = []

        for path, content, base_dir in docs:
            rel = str(path.relative_to(base_dir))
            for idx, chunk in enumerate(self._chunk_text(content)):
                ids.append(f"{base_dir.name}/{rel}:{idx}")
                metadatas.append({"source": f"{base_dir.name}/{rel}"})
                documents.append(chunk)

        try:
            self.client.delete_collection("vochat_docs")
        except Exception:
            pass
        self.collection = self.client.get_or_create_collection("vochat_docs")
        if documents:
            vectors = [vec.tolist() for vec in self.embedding.embed(documents)]
            self.collection.add(ids=ids, metadatas=metadatas, documents=documents, embeddings=vectors)
        self._save_indexed_signature(signature)

    def force_refresh(self) -> int:
        self._save_indexed_signature("")
        self.refresh_if_needed()
        return self.collection.count()

    def retrieve(self, query: str, top_k: int = 3) -> list[Chunk]:
        self.refresh_if_needed()
        if not query.strip():
            return []

        query_vector = next(self.embedding.query_embed(query)).tolist()
        result = self.collection.query(
            query_embeddings=[query_vector],
            n_results=max(1, top_k),
            include=["documents", "metadatas", "distances"],
        )

        docs = result.get("documents", [[]])[0]
        metas = result.get("metadatas", [[]])[0]
        distances = result.get("distances", [[]])[0]
        chunks: list[Chunk] = []
        for doc, meta, distance in zip(docs, metas, distances):
            source = str((meta or {}).get("source", "unknown"))
            chunks.append(Chunk(source=source, text=str(doc), score=float(distance)))
        return chunks

    def chunk_count(self) -> int:
        self.refresh_if_needed()
        return self.collection.count()
