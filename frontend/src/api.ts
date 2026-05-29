const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.trim() || "http://localhost:8000";

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  message: string;
  history: ChatMessage[];
}

export interface ChatResponse {
  reply: string;
}

export interface SttResponse {
  text: string;
}

export interface SttModelInfo {
  id: string;
  name: string;
  available: boolean;
  default: boolean;
}

export interface SttModelsResponse {
  models: SttModelInfo[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function parseError(response: Response): Promise<string> {
  try {
    const data = await response.json();
    if (typeof data.detail === "string") return data.detail;
    if (data.detail?.message) return String(data.detail.message);
    if (data.detail?.detail) {
      return `${data.detail.message ?? "エラー"}: ${data.detail.detail}`;
    }
    return JSON.stringify(data);
  } catch {
    return response.statusText || "Unknown error";
  }
}

export async function sendChat(
  message: string,
  history: ChatMessage[],
): Promise<ChatResponse> {
  const response = await fetch(`${API_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
  });

  if (!response.ok) {
    const detail = await parseError(response);
    throw new ApiError(
      response.status === 503
        ? "LLMに接続できませんでした。モデル配置とコンテナ起動を確認してください。"
        : "チャット送信に失敗しました。",
      response.status,
      detail,
    );
  }

  return response.json() as Promise<ChatResponse>;
}

export async function transcribeAudio(
  file: Blob,
  model?: string,
): Promise<SttResponse> {
  const formData = new FormData();
  formData.append("file", file, "audio.webm");
  if (model) {
    formData.append("model", model);
  }

  const response = await fetch(`${API_BASE_URL}/api/stt`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const detail = await parseError(response);
    throw new ApiError(
      response.status === 504
        ? "音声認識がタイムアウトしました。録音時間を短くするか、軽量モデルを使用してください。"
        : "音声入力に失敗しました。マイク権限やSTTコンテナを確認してください。",
      response.status,
      detail,
    );
  }

  return response.json() as Promise<SttResponse>;
}

export async function getSttModels(): Promise<SttModelsResponse> {
  const response = await fetch(`${API_BASE_URL}/api/stt/models`);

  if (!response.ok) {
    const detail = await parseError(response);
    throw new ApiError(
      "STTモデル一覧の取得に失敗しました。",
      response.status,
      detail,
    );
  }

  return response.json() as Promise<SttModelsResponse>;
}

export async function checkHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

export interface RagDocumentInfo {
  filename: string;
  size: number;
  uploaded_at: string;
  learned: boolean;
}

export interface RagDocumentsResponse {
  documents: RagDocumentInfo[];
}

export interface RagHealthResponse {
  status: string;
  enabled: boolean;
  documents_dir: string;
  uploads_dir: string;
  db_dir: string;
  embedding_model: string;
  chunks: number;
}

export async function getRagHealth(): Promise<RagHealthResponse> {
  const response = await fetch(`${API_BASE_URL}/api/rag/health`);
  if (!response.ok) {
    const detail = await parseError(response);
    throw new ApiError("RAG情報の取得に失敗しました。", response.status, detail);
  }
  return response.json() as Promise<RagHealthResponse>;
}

export async function getRagDocuments(): Promise<RagDocumentsResponse> {
  const response = await fetch(`${API_BASE_URL}/api/rag/documents`);
  if (!response.ok) {
    const detail = await parseError(response);
    throw new ApiError("ドキュメント一覧の取得に失敗しました。", response.status, detail);
  }
  return response.json() as Promise<RagDocumentsResponse>;
}

export async function uploadRagDocument(file: File): Promise<{ filename: string; message: string }> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_BASE_URL}/api/rag/documents`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const detail = await parseError(response);
    throw new ApiError("ファイルのアップロードに失敗しました。", response.status, detail);
  }
  return response.json();
}

export async function deleteRagDocument(filename: string): Promise<{ filename: string; message: string }> {
  const response = await fetch(`${API_BASE_URL}/api/rag/documents/${encodeURIComponent(filename)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const detail = await parseError(response);
    throw new ApiError("ファイルの削除に失敗しました。", response.status, detail);
  }
  return response.json();
}

export interface RagDocumentContentResponse {
  filename: string;
  content: string;
  size: number;
}

export async function getRagDocumentContent(filename: string): Promise<RagDocumentContentResponse> {
  const response = await fetch(`${API_BASE_URL}/api/rag/documents/${encodeURIComponent(filename)}/content`);

  if (!response.ok) {
    const detail = await parseError(response);
    throw new ApiError("ドキュメントの取得に失敗しました。", response.status, detail);
  }
  return response.json();
}

export async function refreshRagIndex(): Promise<{ chunks: number; message: string }> {
  const response = await fetch(`${API_BASE_URL}/api/rag/refresh`, {
    method: "POST",
  });

  if (!response.ok) {
    const detail = await parseError(response);
    throw new ApiError("インデックス再構築に失敗しました。", response.status, detail);
  }
  return response.json();
}

export interface RagUrlResponse {
  url: string;
  title: string;
  message: string;
}

export async function scrapeRagUrl(url: string): Promise<RagUrlResponse> {
  const response = await fetch(`${API_BASE_URL}/api/rag/url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    const detail = await parseError(response);
    throw new ApiError("URLのスクレイピングに失敗しました。", response.status, detail);
  }
  return response.json();
}

export interface RagSitemapResponse {
  xml_url: string;
  scraped_count: number;
  message: string;
}

export async function scrapeRagSitemap(xmlUrl: string, maxUrls: number = 50): Promise<RagSitemapResponse> {
  const response = await fetch(`${API_BASE_URL}/api/rag/sitemap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ xml_url: xmlUrl, max_urls: maxUrls }),
  });

  if (!response.ok) {
    const detail = await parseError(response);
    throw new ApiError("サイトマップのスクレイピングに失敗しました。", response.status, detail);
  }
  return response.json();
}
