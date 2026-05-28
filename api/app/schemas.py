from typing import Literal

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


class ChatRequest(BaseModel):
    message: str = Field(min_length=1)
    history: list[ChatMessage] = Field(default_factory=list)


class ChatResponse(BaseModel):
    reply: str


class SttModelInfo(BaseModel):
    id: str
    name: str
    available: bool
    default: bool


class SttModelsResponse(BaseModel):
    models: list[SttModelInfo]


class SttResponse(BaseModel):
    text: str


class TtsResponse(BaseModel):
    audio_url: str | None = None
    message: str = (
        "Server-side TTS is not implemented yet. Browser speechSynthesis is used for now."
    )


class RagDocumentInfo(BaseModel):
    filename: str
    size: int
    uploaded_at: str


class RagDocumentsResponse(BaseModel):
    documents: list[RagDocumentInfo]


class RagUploadResponse(BaseModel):
    filename: str
    message: str


class RagDeleteResponse(BaseModel):
    filename: str
    message: str


class RagRefreshResponse(BaseModel):
    chunks: int
    message: str


class RagUrlRequest(BaseModel):
    url: str = Field(min_length=1)


class RagUrlResponse(BaseModel):
    url: str
    title: str
    message: str


class RagSitemapRequest(BaseModel):
    xml_url: str = Field(min_length=1)
    max_urls: int = Field(default=50, ge=1, le=200)


class RagSitemapResponse(BaseModel):
    xml_url: str
    scraped_count: int
    message: str


class RagDocumentContentResponse(BaseModel):
    filename: str
    content: str
    size: int
