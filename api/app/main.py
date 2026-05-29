from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
import httpx

from app.extractors import extract_text_from_file, scrape_sitemap_xml, scrape_url
from app.llm_client import LlmClientError, chat_completion, check_llm_health
from app.rag import RagStore
from app.schemas import (
    ChatRequest,
    ChatResponse,
    RagDeleteResponse,
    RagDocumentContentResponse,
    RagDocumentInfo,
    RagDocumentsResponse,
    RagRefreshResponse,
    RagSitemapRequest,
    RagSitemapResponse,
    RagUploadResponse,
    RagUrlRequest,
    RagUrlResponse,
    SttModelsResponse,
    SttResponse,
    TtsResponse,
)
from app.settings import settings

app = FastAPI(title="vo-chat API", version="0.1.0")

uploads_dir = Path(settings.rag_uploads_dir)
uploads_dir.mkdir(parents=True, exist_ok=True)

rag_store = RagStore(
    docs_dirs=[settings.rag_documents_dir, settings.rag_uploads_dir],
    db_dir=settings.rag_db_dir,
    embedding_model=settings.rag_embedding_model,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/llm/health")
async def llm_health() -> dict[str, str]:
    return await check_llm_health()


@app.get("/api/rag/health")
async def rag_health() -> dict[str, str | int | bool]:
    return {
        "status": "ok",
        "enabled": settings.rag_enabled,
        "documents_dir": settings.rag_documents_dir,
        "uploads_dir": settings.rag_uploads_dir,
        "db_dir": settings.rag_db_dir,
        "embedding_model": settings.rag_embedding_model,
        "chunks": rag_store.chunk_count(),
    }


SUPPORTED_EXTENSIONS = (".md", ".txt", ".pdf", ".pptx", ".ppt")


@app.get("/api/rag/documents", response_model=RagDocumentsResponse)
async def rag_documents() -> RagDocumentsResponse:
    documents: list[RagDocumentInfo] = []
    indexed_sources = rag_store.indexed_sources()
    if uploads_dir.exists():
        for pattern in ("*.md", "*.txt", "*.pdf", "*.pptx", "*.ppt"):
            for path in uploads_dir.glob(pattern):
                stat = path.stat()
                uploaded_at = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
                source_key = f"{uploads_dir.name}/{path.name}"
                documents.append(
                    RagDocumentInfo(
                        filename=path.name,
                        size=stat.st_size,
                        uploaded_at=uploaded_at,
                        learned=source_key in indexed_sources,
                    )
                )
    documents.sort(key=lambda d: d.uploaded_at, reverse=True)
    return RagDocumentsResponse(documents=documents)


@app.post("/api/rag/documents", response_model=RagUploadResponse)
async def rag_upload(file: UploadFile = File(...)) -> RagUploadResponse:
    if not file.filename:
        raise HTTPException(status_code=400, detail="ファイル名が必要です。")

    ext = Path(file.filename).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"対応ファイル形式は {', '.join(SUPPORTED_EXTENSIONS)} です。",
        )

    safe_filename = Path(file.filename).name

    try:
        content = await file.read()

        if ext in (".pdf", ".pptx", ".ppt"):
            extracted = extract_text_from_file(content, safe_filename)
            txt_filename = Path(safe_filename).stem + ".txt"
            dest = uploads_dir / txt_filename
            dest.write_text(extracted.text, encoding="utf-8")
            return RagUploadResponse(
                filename=txt_filename,
                message=f"{safe_filename} からテキストを抽出しました",
            )
        else:
            dest = uploads_dir / safe_filename
            dest.write_bytes(content)
            return RagUploadResponse(filename=safe_filename, message="アップロード完了")

    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"ファイル処理に失敗しました: {exc}",
        ) from exc


@app.delete("/api/rag/documents/{filename}", response_model=RagDeleteResponse)
async def rag_delete(filename: str) -> RagDeleteResponse:
    safe_filename = Path(filename).name
    target = uploads_dir / safe_filename

    if not target.exists():
        raise HTTPException(status_code=404, detail="ファイルが見つかりません。")

    try:
        target.unlink()
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"ファイル削除に失敗しました: {exc}",
        ) from exc

    return RagDeleteResponse(filename=safe_filename, message="削除完了")


@app.get("/api/rag/documents/{filename}/content", response_model=RagDocumentContentResponse)
async def rag_document_content(filename: str) -> RagDocumentContentResponse:
    safe_filename = Path(filename).name
    target = uploads_dir / safe_filename

    if not target.exists():
        raise HTTPException(status_code=404, detail="ファイルが見つかりません。")

    try:
        content = target.read_text(encoding="utf-8", errors="ignore")
        stat = target.stat()
        return RagDocumentContentResponse(
            filename=safe_filename,
            content=content,
            size=stat.st_size,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"ファイル読み込みに失敗しました: {exc}",
        ) from exc


@app.post("/api/rag/refresh", response_model=RagRefreshResponse)
async def rag_refresh() -> RagRefreshResponse:
    chunks = rag_store.force_refresh()
    return RagRefreshResponse(chunks=chunks, message="インデックスを再構築しました")


@app.post("/api/rag/url", response_model=RagUrlResponse)
async def rag_scrape_url(request: RagUrlRequest) -> RagUrlResponse:
    try:
        doc = await scrape_url(request.url)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"URLの取得に失敗しました（ステータス: {exc.response.status_code}）",
        ) from exc
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"URLへの接続に失敗しました: {exc}",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"スクレイピングに失敗しました: {exc}",
        ) from exc

    if not doc.text.strip():
        raise HTTPException(status_code=400, detail="URLからテキストを抽出できませんでした。")

    import hashlib
    url_hash = hashlib.md5(request.url.encode()).hexdigest()[:8]
    safe_title = "".join(c if c.isalnum() or c in "-_" else "_" for c in doc.source[:50])
    filename = f"url_{url_hash}_{safe_title}.txt"

    dest = uploads_dir / filename
    dest.write_text(f"# {doc.source}\nURL: {request.url}\n\n{doc.text}", encoding="utf-8")

    return RagUrlResponse(url=request.url, title=doc.source, message=f"URLからテキストを取得しました")


@app.post("/api/rag/sitemap", response_model=RagSitemapResponse)
async def rag_scrape_sitemap(request: RagSitemapRequest) -> RagSitemapResponse:
    try:
        docs = await scrape_sitemap_xml(request.xml_url, max_urls=request.max_urls)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"XMLの取得に失敗しました（ステータス: {exc.response.status_code}）",
        ) from exc
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"XMLへの接続に失敗しました: {exc}",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"サイトマップ処理に失敗しました: {exc}",
        ) from exc

    if not docs:
        raise HTTPException(status_code=400, detail="サイトマップからテキストを取得できませんでした。")

    import hashlib
    xml_hash = hashlib.md5(request.xml_url.encode()).hexdigest()[:8]

    for i, doc in enumerate(docs):
        safe_title = "".join(c if c.isalnum() or c in "-_" else "_" for c in doc.source[:40])
        filename = f"sitemap_{xml_hash}_{i:03d}_{safe_title}.txt"
        dest = uploads_dir / filename
        dest.write_text(f"# {doc.source}\n\n{doc.text}", encoding="utf-8")

    return RagSitemapResponse(
        xml_url=request.xml_url,
        scraped_count=len(docs),
        message=f"サイトマップから{len(docs)}ページを取得しました",
    )


@app.get("/api/rag/search")
async def rag_search(q: str, top_k: int = 3) -> dict[str, object]:
    if not settings.rag_enabled:
        return {"enabled": False, "results": []}

    chunks = rag_store.retrieve(q, top_k=max(1, min(top_k, 10)))
    return {
        "enabled": True,
        "results": [{"source": chunk.source, "text": chunk.text} for chunk in chunks],
    }


@app.get("/api/stt/health")
async def stt_health() -> dict[str, str]:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{settings.stt_api_base_url.rstrip('/')}/health")
            response.raise_for_status()
            data = response.json()
            return {
                "status": data.get("status", "ok"),
                "engine": data.get("engine", "whisper.cpp"),
            }
    except httpx.ConnectError as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "message": "STTサーバーに接続できません。sttコンテナを確認してください。",
                "detail": str(exc),
            },
        ) from exc
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=504,
            detail={
                "message": "STTヘルスチェックがタイムアウトしました。",
                "detail": str(exc),
            },
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "message": "STTサーバーの応答が不正です。",
                "detail": str(exc),
            },
        ) from exc


@app.get("/api/stt/models", response_model=SttModelsResponse)
async def stt_models() -> SttModelsResponse:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{settings.stt_api_base_url.rstrip('/')}/models")
            response.raise_for_status()
            data = response.json()
            return SttModelsResponse(models=data.get("models", []))
    except httpx.ConnectError as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "message": "STTサーバーに接続できません。sttコンテナを確認してください。",
                "detail": str(exc),
            },
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "message": "STTサーバーの応答が不正です。",
                "detail": str(exc),
            },
        ) from exc


@app.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    history = [{"role": msg.role, "content": msg.content} for msg in request.history]
    rag_blocks: list[str] = []
    if settings.rag_enabled:
        chunks = rag_store.retrieve(request.message, top_k=settings.rag_top_k)
        rag_blocks = [f"[source: {chunk.source}]\n{chunk.text}" for chunk in chunks]
    try:
        reply = await chat_completion(request.message, history, rag_context_blocks=rag_blocks)
    except LlmClientError as exc:
        detail = exc.detail or exc.message
        raise HTTPException(
            status_code=503,
            detail={"message": exc.message, "detail": detail},
        ) from exc
    return ChatResponse(reply=reply.strip() or "（応答が空でした）")


@app.post("/api/stt", response_model=SttResponse)
async def stt(
    file: UploadFile = File(...),
    model: Optional[str] = Form(None),
) -> SttResponse:
    try:
        content = await file.read()
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail={"message": "音声ファイルの読み込みに失敗しました。", "detail": str(exc)},
        ) from exc

    files = {
        "file": (
            file.filename or "audio.webm",
            content,
            file.content_type or "application/octet-stream",
        )
    }
    data = {"language": "ja"}
    if model:
        data["model"] = model

    try:
        async with httpx.AsyncClient(timeout=settings.stt_timeout_seconds) as client:
            response = await client.post(
                f"{settings.stt_api_base_url.rstrip('/')}/transcribe",
                files=files,
                data=data,
            )
    except httpx.ConnectError as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "message": "STTサーバーに接続できません。sttコンテナの起動を確認してください。",
                "detail": str(exc),
            },
        ) from exc
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=504,
            detail={
                "message": "音声認識がタイムアウトしました。録音時間を短くするか、軽量モデルを使用してください。",
                "detail": str(exc),
            },
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "message": "STTサーバーとの通信に失敗しました。",
                "detail": str(exc),
            },
        ) from exc

    if response.status_code >= 400:
        try:
            detail = response.json()
        except ValueError:
            detail = response.text
        raise HTTPException(
            status_code=502,
            detail={
                "message": "STTサーバーで文字起こしに失敗しました。",
                "detail": detail,
            },
        )

    try:
        payload = response.json()
        text = str(payload.get("text", "")).strip()
    except ValueError as exc:
        raise HTTPException(
            status_code=502,
            detail={"message": "STTサーバーのレスポンス形式が不正です。", "detail": response.text},
        ) from exc

    return SttResponse(text=text)


@app.post("/api/tts", response_model=TtsResponse)
async def tts() -> TtsResponse:
    return TtsResponse()
