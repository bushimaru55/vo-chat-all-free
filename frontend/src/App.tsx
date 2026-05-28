import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ApiError,
  ChatMessage,
  getSttModels,
  sendChat,
  SttModelInfo,
  transcribeAudio,
} from "./api";

interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

const MAX_RECORDING_MS = 30_000;
const SILENCE_THRESHOLD = 0.01;
const SILENCE_DURATION_MS = 2000;

function speakText(text: string, onEnd: () => void) {
  if (!("speechSynthesis" in window)) {
    onEnd();
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ja-JP";
  utterance.onend = onEnd;
  utterance.onerror = onEnd;
  window.speechSynthesis.speak(utterance);
}

function getRecorderMimeType(): string | undefined {
  if (!("MediaRecorder" in window) || typeof MediaRecorder.isTypeSupported !== "function") {
    return undefined;
  }
  if (MediaRecorder.isTypeSupported("audio/webm")) {
    return "audio/webm";
  }
  return undefined;
}

export default function App() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readAloud, setReadAloud] = useState(true);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [sttModels, setSttModels] = useState<SttModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const selectedModelRef = useRef<string>("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const vadIntervalRef = useRef<number | null>(null);
  const voiceModeRef = useRef<boolean>(false);
  const messagesRef = useRef<DisplayMessage[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    voiceModeRef.current = isVoiceMode;
  }, [isVoiceMode]);

  useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);

  useEffect(() => {
    getSttModels()
      .then((res) => {
        setSttModels(res.models);
        const defaultModel = res.models.find((m) => m.default && m.available);
        const firstAvailable = res.models.find((m) => m.available);
        const modelToSelect = defaultModel || firstAvailable;
        if (modelToSelect) {
          setSelectedModel(modelToSelect.id);
        }
      })
      .catch(() => {
        setSttModels([]);
      });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    return () => {
      cleanupRecording();
    };
  }, []);

  const cleanupRecording = useCallback(() => {
    if (recordingTimerRef.current) {
      window.clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (vadIntervalRef.current) {
      window.clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close();
    }
    audioContextRef.current = null;
    analyserRef.current = null;
    silenceStartRef.current = null;
  }, []);

  const buildHistory = useCallback((): ChatMessage[] => {
    return messagesRef.current.map((m) => ({
      role: m.role,
      content: m.content,
    }));
  }, []);

  const startRecording = useCallback(async () => {
    if (!voiceModeRef.current) return;

    setError(null);
    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;
      silenceStartRef.current = null;

      const checkSilence = () => {
        if (!analyserRef.current || !voiceModeRef.current) return;

        const dataArray = new Uint8Array(analyserRef.current.fftSize);
        analyserRef.current.getByteTimeDomainData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const normalized = (dataArray[i] - 128) / 128;
          sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / dataArray.length);

        const now = Date.now();

        if (rms < SILENCE_THRESHOLD) {
          if (silenceStartRef.current === null) {
            silenceStartRef.current = now;
          } else if (now - silenceStartRef.current >= SILENCE_DURATION_MS) {
            setVoiceNotice("無音を検知しました。自動送信します...");
            stopCurrentRecording();
          }
        } else {
          silenceStartRef.current = null;
        }
      };

      vadIntervalRef.current = window.setInterval(checkSilence, 100);

      const mimeType = getRecorderMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        setIsRecording(false);
        setVoiceNotice("音声入力に失敗しました。マイク権限やSTTコンテナを確認してください。");
        cleanupRecording();
        if (voiceModeRef.current) {
          setIsVoiceMode(false);
        }
      };

      recorder.onstop = async () => {
        setIsRecording(false);

        if (vadIntervalRef.current) {
          window.clearInterval(vadIntervalRef.current);
          vadIntervalRef.current = null;
        }

        const blobType = mimeType ?? recorder.mimeType ?? "audio/webm";
        const audioBlob = new Blob(audioChunksRef.current, { type: blobType });
        audioChunksRef.current = [];

        stream.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;

        if (audioContextRef.current && audioContextRef.current.state !== "closed") {
          audioContextRef.current.close();
        }
        audioContextRef.current = null;
        analyserRef.current = null;

        if (audioBlob.size === 0) {
          setVoiceNotice("録音データが空でした。");
          if (voiceModeRef.current) {
            setTimeout(() => startRecording(), 500);
          }
          return;
        }

        if (!voiceModeRef.current) {
          return;
        }

        setIsTranscribing(true);
        setVoiceNotice("文字起こし中...");

        try {
          const { text } = await transcribeAudio(audioBlob, selectedModelRef.current || undefined);
          const trimmedText = text.trim();

          if (!trimmedText || trimmedText === "(音楽)") {
            setVoiceNotice("音声が検出されませんでした。再度録音を開始します...");
            setIsTranscribing(false);
            if (voiceModeRef.current) {
              setTimeout(() => startRecording(), 500);
            }
            return;
          }

          setInput(trimmedText);
          setVoiceNotice("送信中...");

          const userMsg: DisplayMessage = {
            id: crypto.randomUUID(),
            role: "user",
            content: trimmedText,
          };

          setMessages((prev) => [...prev, userMsg]);
          setInput("");
          setLoading(true);
          setIsTranscribing(false);

          try {
            const history = buildHistory();
            const { reply } = await sendChat(trimmedText, history);
            const assistantMsg: DisplayMessage = {
              id: crypto.randomUUID(),
              role: "assistant",
              content: reply,
            };
            setMessages((prev) => [...prev, assistantMsg]);

            if (readAloud && voiceModeRef.current) {
              setVoiceNotice("読み上げ中...");
              speakText(reply, () => {
                if (voiceModeRef.current) {
                  setVoiceNotice("録音中...2秒無音で自動送信");
                  startRecording();
                }
              });
            } else if (voiceModeRef.current) {
              setVoiceNotice("録音中...2秒無音で自動送信");
              startRecording();
            }
          } catch (err) {
            const message =
              err instanceof ApiError
                ? err.detail
                  ? `${err.message}\n${err.detail}`
                  : err.message
                : "予期しないエラーが発生しました。";
            setError(message);
            if (voiceModeRef.current) {
              setVoiceNotice("エラーが発生しました。再度録音を開始します...");
              setTimeout(() => startRecording(), 1000);
            }
          } finally {
            setLoading(false);
          }
        } catch (err) {
          const message =
            err instanceof ApiError
              ? err.detail
                ? `${err.message}\n${err.detail}`
                : err.message
              : "音声入力に失敗しました。マイク権限やSTTコンテナを確認してください。";
          setError(message);
          setVoiceNotice("文字起こしに失敗しました。再度録音を開始します...");
          setIsTranscribing(false);
          if (voiceModeRef.current) {
            setTimeout(() => startRecording(), 1000);
          }
        }
      };

      recorder.start();
      setIsRecording(true);
      setVoiceNotice("録音中...2秒無音で自動送信");

      recordingTimerRef.current = window.setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
          setVoiceNotice("最大録音時間（30秒）に達しました。文字起こしします...");
          stopCurrentRecording();
        }
      }, MAX_RECORDING_MS);
    } catch (err) {
      const errorName = err instanceof DOMException ? err.name : "";
      if (errorName === "NotAllowedError") {
        setVoiceNotice("マイクの使用が許可されていません。ブラウザの権限設定を確認してください。");
      } else {
        setVoiceNotice("音声入力に失敗しました。マイク権限やSTTコンテナを確認してください。");
      }
      setIsVoiceMode(false);
    }
  }, [buildHistory, cleanupRecording, readAloud]);

  const stopCurrentRecording = useCallback(() => {
    if (recordingTimerRef.current) {
      window.clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (vadIntervalRef.current) {
      window.clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const handleVoiceToggle = useCallback(() => {
    if (!("mediaDevices" in navigator) || !("MediaRecorder" in window)) {
      setVoiceNotice("お使いのブラウザは音声入力に対応していません。Chrome/Edge/Safariをお試しください。");
      return;
    }

    if (isVoiceMode) {
      setIsVoiceMode(false);
      voiceModeRef.current = false;
      window.speechSynthesis?.cancel();
      cleanupRecording();
      setIsRecording(false);
      setIsTranscribing(false);
      setVoiceNotice(null);
    } else {
      setIsVoiceMode(true);
      voiceModeRef.current = true;
      startRecording();
    }
  }, [isVoiceMode, cleanupRecording, startRecording]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading || isTranscribing) return;

    const userMsg: DisplayMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setError(null);
    setLoading(true);

    try {
      const history = buildHistory();
      const { reply } = await sendChat(trimmed, history);
      const assistantMsg: DisplayMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: reply,
      };
      setMessages((prev) => [...prev, assistantMsg]);

      if (readAloud) {
        speakText(reply, () => undefined);
      }
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.detail
            ? `${err.message}\n${err.detail}`
            : err.message
          : "予期しないエラーが発生しました。";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const voiceButtonLabel = isTranscribing
    ? "処理中..."
    : isVoiceMode
      ? "音声停止"
      : "音声入力";

  return (
    <div className="app">
      <header className="header">
        <div className="header-title">
          <h1>vo-chat</h1>
          <p className="subtitle">ローカルAIチャット（全Docker構成）</p>
        </div>
        <Link to="/admin" className="btn btn-admin" title="RAG管理">
          管理
        </Link>
      </header>

      <main className="chat-panel">
        <div className="messages" role="log" aria-live="polite">
          {messages.length === 0 && !loading && (
            <p className="empty-hint">
              メッセージを入力して送信してください。回答はブラウザで読み上げできます。
            </p>
          )}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`message message--${msg.role}`}
            >
              <span className="message-label">
                {msg.role === "user" ? "あなた" : "AI"}
              </span>
              <p className="message-content">{msg.content}</p>
            </div>
          ))}
          {loading && (
            <div className="message message--assistant message--loading">
              <span className="message-label">AI</span>
              <p className="message-content">考え中...</p>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        {voiceNotice && (
          <div className="notice-banner" role="status">
            {voiceNotice}
          </div>
        )}

        <form className="input-bar" onSubmit={handleSubmit}>
          <div className="settings-row">
            <label className="toggle-read">
              <input
                type="checkbox"
                checked={readAloud}
                onChange={(e) => {
                  setReadAloud(e.target.checked);
                  if (!e.target.checked) window.speechSynthesis?.cancel();
                }}
              />
              読み上げ
            </label>

            <label className="model-select-label">
              STTモデル:
              <select
                className="model-select"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                disabled={isVoiceMode || isTranscribing}
              >
                {sttModels.map((m) => (
                  <option key={m.id} value={m.id} disabled={!m.available}>
                    {m.id} {!m.available && "(未取得)"}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="input-row">
            <button
              type="button"
              className={`btn btn-voice ${isVoiceMode ? "btn-voice--active" : ""}`}
              onClick={handleVoiceToggle}
              disabled={loading || isTranscribing}
              title={voiceButtonLabel}
              aria-label={voiceButtonLabel}
            >
              {voiceButtonLabel}
            </button>
            <input
              type="text"
              className="text-input"
              placeholder="メッセージを入力..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading || isTranscribing || isVoiceMode}
              autoComplete="off"
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || isTranscribing || !input.trim() || isVoiceMode}
            >
              送信
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
