import os
import subprocess
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile

app = FastAPI(title="vo-chat STT", version="0.1.0")

MODELS_DIR = Path("/models")
AVAILABLE_MODELS = {
    "base": "ggml-base.bin",
    "small": "ggml-small.bin",
    "medium": "ggml-medium.bin",
}
DEFAULT_MODEL = os.getenv("STT_DEFAULT_MODEL", "medium")
STT_LANGUAGE = os.getenv("STT_LANGUAGE", "ja")
STT_THREADS = os.getenv("STT_THREADS", "4")
TMP_DIR = Path("/tmp/vo-chat")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "engine": "whisper.cpp"}


@app.get("/models")
async def list_models() -> dict[str, list[dict[str, str | bool]]]:
    models = []
    for key, filename in AVAILABLE_MODELS.items():
        model_path = MODELS_DIR / filename
        models.append({
            "id": key,
            "name": filename,
            "available": model_path.exists(),
            "default": key == DEFAULT_MODEL,
        })
    return {"models": models}


@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    language: str = Form("ja"),
    model: str = Form(None),
) -> dict[str, str]:
    selected_model = model if model in AVAILABLE_MODELS else DEFAULT_MODEL
    model_filename = AVAILABLE_MODELS[selected_model]
    model_path = MODELS_DIR / model_filename

    if not model_path.exists():
        raise HTTPException(
            status_code=500,
            detail=f"STT model file not found: {model_path}. Available models: {list(AVAILABLE_MODELS.keys())}",
        )

    TMP_DIR.mkdir(parents=True, exist_ok=True)
    req_id = uuid.uuid4().hex
    input_path = TMP_DIR / f"input_{req_id}_{file.filename or 'audio.bin'}"
    wav_path = TMP_DIR / f"input_{req_id}.wav"
    output_prefix = TMP_DIR / f"output_{req_id}"
    output_txt = TMP_DIR / f"output_{req_id}.txt"

    try:
        content = await file.read()
        input_path.write_bytes(content)

        ffmpeg_cmd = [
            "ffmpeg",
            "-y",
            "-i",
            str(input_path),
            "-ar",
            "16000",
            "-ac",
            "1",
            "-acodec",
            "pcm_s16le",
            "-af",
            "highpass=f=200,lowpass=f=3000,afftdn=nf=-25",
            str(wav_path),
        ]
        ffmpeg_result = subprocess.run(ffmpeg_cmd, capture_output=True, text=True)
        if ffmpeg_result.returncode != 0:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "Audio conversion failed.",
                    "detail": ffmpeg_result.stderr[-2000:],
                },
            )

        whisper_cmd = [
            "whisper-cli",
            "-m",
            str(model_path),
            "-f",
            str(wav_path),
            "-l",
            language or STT_LANGUAGE,
            "-nt",
            "-t",
            STT_THREADS,
            "-bs",
            "8",
            "-wt",
            "0.01",
            "-et",
            "2.4",
            "-otxt",
            "-of",
            str(output_prefix),
        ]
        whisper_result = subprocess.run(whisper_cmd, capture_output=True, text=True)
        if whisper_result.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail={
                    "error": "Transcription failed.",
                    "detail": whisper_result.stderr[-2000:] or whisper_result.stdout[-2000:],
                },
            )

        if output_txt.exists():
            text = output_txt.read_text(encoding="utf-8", errors="ignore").strip()
        else:
            text = "\n".join(
                [line.strip() for line in whisper_result.stdout.splitlines() if line.strip()]
            ).strip()

        return {"text": text, "language": language or STT_LANGUAGE, "model": selected_model}

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={"error": "Transcription failed.", "detail": str(exc)},
        ) from exc
    finally:
        for p in (input_path, wav_path, output_txt):
            try:
                if p.exists():
                    p.unlink()
            except OSError:
                pass
