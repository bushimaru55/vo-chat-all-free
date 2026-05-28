import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import AdminLogin from "./AdminLogin";
import {
  ApiError,
  deleteRagDocument,
  getRagDocumentContent,
  getRagDocuments,
  getRagHealth,
  RagDocumentInfo,
  RagHealthResponse,
  refreshRagIndex,
  scrapeRagSitemap,
  scrapeRagUrl,
  uploadRagDocument,
} from "./api";

type SourceTab = "file" | "url" | "sitemap";

interface PreviewData {
  filename: string;
  content: string;
}

export default function AdminPage() {
  const navigate = useNavigate();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [ragHealth, setRagHealth] = useState<RagHealthResponse | null>(null);
  const [documents, setDocuments] = useState<RagDocumentInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SourceTab>("file");
  const [urlInput, setUrlInput] = useState("");
  const [sitemapUrl, setSitemapUrl] = useState("");
  const [maxUrls, setMaxUrls] = useState(50);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const auth = sessionStorage.getItem("admin_auth");
    setIsAuthenticated(auth === "true");
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [health, docs] = await Promise.all([getRagHealth(), getRagDocuments()]);
      setRagHealth(health);
      setDocuments(docs.documents);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "データの取得に失敗しました。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      loadData();
    }
  }, [isAuthenticated, loadData]);

  const handleLogout = () => {
    sessionStorage.removeItem("admin_auth");
    setIsAuthenticated(false);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await uploadRagDocument(file);
      setSuccess(result.message);
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "アップロードに失敗しました。");
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleUrlSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;

    setUploading(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await scrapeRagUrl(urlInput.trim());
      setSuccess(`「${result.title}」を取得しました。`);
      setUrlInput("");
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "URLの取得に失敗しました。");
    } finally {
      setUploading(false);
    }
  };

  const handleSitemapSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!sitemapUrl.trim()) return;

    setUploading(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await scrapeRagSitemap(sitemapUrl.trim(), maxUrls);
      setSuccess(result.message);
      setSitemapUrl("");
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "サイトマップの取得に失敗しました。");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (filename: string) => {
    if (!confirm(`「${filename}」を削除しますか？`)) return;

    setError(null);
    setSuccess(null);

    try {
      await deleteRagDocument(filename);
      setSuccess(`「${filename}」を削除しました。`);
      if (preview?.filename === filename) {
        setPreview(null);
      }
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "削除に失敗しました。");
    }
  };

  const handlePreview = async (filename: string) => {
    setPreviewLoading(true);
    setError(null);

    try {
      const result = await getRagDocumentContent(filename);
      setPreview({ filename: result.filename, content: result.content });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "プレビューの取得に失敗しました。");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await refreshRagIndex();
      setSuccess(`インデックスを再構築しました（${result.chunks}チャンク）`);
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "再構築に失敗しました。");
    } finally {
      setRefreshing(false);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleString("ja-JP");
  };

  if (!isAuthenticated) {
    return <AdminLogin onLogin={() => setIsAuthenticated(true)} />;
  }

  return (
    <div className="admin-page">
      <header className="admin-page-header">
        <div className="admin-page-title">
          <h1>RAG 管理画面</h1>
        </div>
        <div className="admin-page-actions">
          <button className="btn btn-secondary" onClick={() => navigate("/")}>
            チャットに戻る
          </button>
          <button className="btn btn-logout" onClick={handleLogout}>
            ログアウト
          </button>
        </div>
      </header>

      <main className="admin-page-content">
        {error && <div className="admin-error">{error}</div>}
        {success && <div className="admin-success">{success}</div>}

        <section className="admin-card">
          <h2>ステータス</h2>
          {loading ? (
            <p className="admin-loading">読み込み中...</p>
          ) : ragHealth ? (
            <div className="admin-status">
              <div className="status-item">
                <span className="status-label">状態:</span>
                <span className={`status-value ${ragHealth.enabled ? "enabled" : "disabled"}`}>
                  {ragHealth.enabled ? "有効" : "無効"}
                </span>
              </div>
              <div className="status-item">
                <span className="status-label">チャンク数:</span>
                <span className="status-value">{ragHealth.chunks}</span>
              </div>
              <div className="status-item">
                <span className="status-label">埋め込みモデル:</span>
                <span className="status-value small">{ragHealth.embedding_model}</span>
              </div>
            </div>
          ) : (
            <p>情報を取得できませんでした。</p>
          )}
        </section>

        <section className="admin-card">
          <h2>学習データの追加</h2>

          <div className="source-tabs">
            <button
              className={`tab-btn ${activeTab === "file" ? "active" : ""}`}
              onClick={() => setActiveTab("file")}
            >
              ファイル
            </button>
            <button
              className={`tab-btn ${activeTab === "url" ? "active" : ""}`}
              onClick={() => setActiveTab("url")}
            >
              URL
            </button>
            <button
              className={`tab-btn ${activeTab === "sitemap" ? "active" : ""}`}
              onClick={() => setActiveTab("sitemap")}
            >
              サイトマップXML
            </button>
          </div>

          <div className="tab-content">
            {activeTab === "file" && (
              <div className="tab-panel">
                <p className="admin-hint">対応形式: .md, .txt, .pdf, .pptx</p>
                <div className="upload-area">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".md,.txt,.pdf,.pptx,.ppt"
                    onChange={handleUpload}
                    disabled={uploading}
                    id="file-upload"
                  />
                  <label htmlFor="file-upload" className="btn btn-upload">
                    {uploading ? "処理中..." : "ファイルを選択"}
                  </label>
                </div>
              </div>
            )}

            {activeTab === "url" && (
              <div className="tab-panel">
                <p className="admin-hint">WebページのURLを入力してテキストを取得します</p>
                <form className="url-form" onSubmit={handleUrlSubmit}>
                  <input
                    type="url"
                    className="url-input"
                    placeholder="https://example.com/page"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    disabled={uploading}
                    required
                  />
                  <button type="submit" className="btn btn-upload" disabled={uploading || !urlInput.trim()}>
                    {uploading ? "取得中..." : "取得"}
                  </button>
                </form>
              </div>
            )}

            {activeTab === "sitemap" && (
              <div className="tab-panel">
                <p className="admin-hint">サイトマップXMLのURLを入力して複数ページを一括取得します</p>
                <form className="url-form" onSubmit={handleSitemapSubmit}>
                  <input
                    type="url"
                    className="url-input"
                    placeholder="https://example.com/sitemap.xml"
                    value={sitemapUrl}
                    onChange={(e) => setSitemapUrl(e.target.value)}
                    disabled={uploading}
                    required
                  />
                  <div className="max-urls-field">
                    <label>
                      最大取得数:
                      <input
                        type="number"
                        className="max-urls-input"
                        min="1"
                        max="200"
                        value={maxUrls}
                        onChange={(e) => setMaxUrls(Math.min(200, Math.max(1, parseInt(e.target.value) || 50)))}
                        disabled={uploading}
                      />
                    </label>
                  </div>
                  <button type="submit" className="btn btn-upload" disabled={uploading || !sitemapUrl.trim()}>
                    {uploading ? "取得中..." : "一括取得"}
                  </button>
                </form>
              </div>
            )}
          </div>
        </section>

        <section className="admin-card">
          <div className="section-header">
            <h2>登録済みドキュメント</h2>
            <button
              className="btn btn-refresh"
              onClick={handleRefresh}
              disabled={refreshing}
              title="インデックス再構築"
            >
              {refreshing ? "再構築中..." : "再構築"}
            </button>
          </div>

          {documents.length === 0 ? (
            <p className="admin-empty">登録済みのドキュメントはありません。</p>
          ) : (
            <ul className="document-list">
              {documents.map((doc) => (
                <li key={doc.filename} className="document-item">
                  <div className="document-info">
                    <span className="document-name">{doc.filename}</span>
                    <span className="document-meta">
                      {formatSize(doc.size)} • {formatDate(doc.uploaded_at)}
                    </span>
                  </div>
                  <div className="document-actions">
                    <button
                      className="btn btn-preview"
                      onClick={() => handlePreview(doc.filename)}
                      disabled={previewLoading}
                      title="プレビュー"
                    >
                      確認
                    </button>
                    <button
                      className="btn btn-delete"
                      onClick={() => handleDelete(doc.filename)}
                      title="削除"
                    >
                      削除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

      </main>

      {preview &&
        createPortal(
          <div className="modal-overlay" onClick={() => setPreview(null)}>
            <div className="modal-content preview-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>プレビュー: {preview.filename}</h2>
                <button
                  className="btn btn-close-modal"
                  onClick={() => setPreview(null)}
                  title="閉じる"
                >
                  ×
                </button>
              </div>
              <div className="modal-body">
                <pre>{preview.content}</pre>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
