from typing import Any

import httpx

from app.settings import settings

SYSTEM_PROMPT = (
    "あなたは「おりこうAIコンシェルジュ」に関する質問に答える日本語アシスタントです。"
    "回答の優先順位は『ユーザー指示 > RAG参照コンテキスト > 一般知識』です。"
    "RAG参照コンテキストが与えられた場合は、その記載のみを根拠に回答してください。"
    "コンテキストにない語句・対象者・機能名を追加しないでください。"
)


class LlmClientError(Exception):
    def __init__(self, message: str, detail: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.detail = detail


def _chat_completions_url() -> str:
    base = settings.llm_api_base_url.rstrip("/")
    return f"{base}/v1/chat/completions"


def _health_url() -> str:
    base = settings.llm_api_base_url.rstrip("/")
    return f"{base}/health"


async def check_llm_health() -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(_health_url())
            if response.status_code == 200:
                return {"llm_status": "ok"}
            return {
                "llm_status": "error",
                "detail": f"LLM server returned HTTP {response.status_code}.",
            }
    except httpx.ConnectError:
        return {
            "llm_status": "error",
            "detail": "Could not connect to LLM server.",
        }
    except httpx.TimeoutException:
        return {
            "llm_status": "error",
            "detail": "LLM health check timed out.",
        }
    except httpx.HTTPError as exc:
        return {
            "llm_status": "error",
            "detail": f"LLM health check failed: {exc}",
        }


def _build_rag_message(context_blocks: list[str]) -> str:
    joined = "\n\n".join(context_blocks)
    return (
        "以下は学習データ（RAG検索結果）です。回答はこの引用のみに基づいてください。\n"
        "【厳守ルール】\n"
        "1. コンテキストに書かれている語句をそのまま使う（言い換え・類推禁止）\n"
        "2. 「学習データ」はAI向けの参照データのこと。「学生」「生徒」と混同しない\n"
        "3. コンテキストにない語（例: 学生、学校、授業）は絶対に使わない\n"
        "4. 対象は「ユーザー」「お客様」「Webサイト訪問者」など、文脈に書かれた表現のみ\n"
        "5. 不明な点は推測せず「資料では確認できません」と答える\n"
        "6. 箇条書きで簡潔に答える\n\n"
        f"{joined}"
    )


async def chat_completion(
    user_message: str,
    history: list[dict[str, str]],
    rag_context_blocks: list[str] | None = None,
) -> str:
    messages: list[dict[str, str]] = [{"role": "system", "content": SYSTEM_PROMPT}]
    if rag_context_blocks:
        messages.append({"role": "system", "content": _build_rag_message(rag_context_blocks)})
    messages.extend(history)
    messages.append({"role": "user", "content": user_message})

    temperature = 0.2 if rag_context_blocks else settings.llm_temperature
    max_tokens = min(settings.llm_max_tokens, 384) if rag_context_blocks else settings.llm_max_tokens
    payload = {
        "model": settings.llm_model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    try:
        async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
            response = await client.post(_chat_completions_url(), json=payload)
    except httpx.ConnectError as exc:
        raise LlmClientError(
            "LLMサーバーに接続できません。llmコンテナの起動とモデル配置を確認してください。",
            str(exc),
        ) from exc
    except httpx.TimeoutException as exc:
        raise LlmClientError(
            "LLMサーバーへのリクエストがタイムアウトしました。モデルが大きい場合は時間がかかります。",
            str(exc),
        ) from exc
    except httpx.HTTPError as exc:
        raise LlmClientError("LLMサーバーとの通信に失敗しました。", str(exc)) from exc

    if response.status_code >= 500:
        raise LlmClientError(
            "LLMサーバーでエラーが発生しました。モデルファイルの読み込みに失敗している可能性があります。",
            response.text[:500],
        )

    if response.status_code >= 400:
        raise LlmClientError(
            "LLMサーバーがリクエストを拒否しました。",
            response.text[:500],
        )

    try:
        data = response.json()
    except ValueError as exc:
        raise LlmClientError(
            "LLMサーバーのレスポンス形式が想定と異なります（JSONではありません）。",
            response.text[:500],
        ) from exc

    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise LlmClientError(
            "LLMサーバーのレスポンス形式が想定と異なります（choices[0].message.contentがありません）。",
            str(data)[:500],
        ) from exc
