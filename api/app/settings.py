from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    llm_api_base_url: str = "http://llm:8080"
    llm_model: str = "local-model"
    llm_timeout_seconds: float = 180.0
    llm_max_tokens: int = 512
    llm_temperature: float = 0.7
    stt_api_base_url: str = "http://stt:9000"
    stt_timeout_seconds: float = 180.0
    rag_enabled: bool = True
    rag_documents_dir: str = "/knowledge"
    rag_uploads_dir: str = "/rag-uploads"
    rag_db_dir: str = "/rag-data"
    rag_embedding_model: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    rag_top_k: int = 3
    api_cors_origins: str = "http://localhost:5173"

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.api_cors_origins.split(",") if origin.strip()]


settings = Settings()
