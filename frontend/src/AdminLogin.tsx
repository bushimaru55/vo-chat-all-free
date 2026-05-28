import { FormEvent, useState } from "react";

interface AdminLoginProps {
  onLogin: () => void;
}

const ADMIN_USER = "admin";
const ADMIN_PASS = "admin";

export default function AdminLogin({ onLogin }: AdminLoginProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (username === ADMIN_USER && password === ADMIN_PASS) {
      sessionStorage.setItem("admin_auth", "true");
      onLogin();
    } else {
      setError("ユーザー名またはパスワードが正しくありません。");
    }
  };

  return (
    <div className="login-container">
      <div className="login-panel">
        <h1>RAG 管理画面</h1>
        <p className="login-subtitle">ログインしてください</p>

        {error && <div className="login-error">{error}</div>}

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="login-field">
            <label htmlFor="username">ユーザー名</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
            />
          </div>
          <div className="login-field">
            <label htmlFor="password">パスワード</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <button type="submit" className="btn btn-primary login-btn">
            ログイン
          </button>
        </form>
      </div>
    </div>
  );
}
