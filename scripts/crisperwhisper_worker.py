#!/usr/bin/env python3
"""Persistent CPU-only CrisperWhisper 2.0 JSON-lines worker.

stdin requests and stdout responses are one JSON object per line. All package
logs and tracebacks stay on stderr so stdout remains a reliable protocol stream.
"""

from __future__ import annotations

import gc
from contextlib import redirect_stdout
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import traceback
from typing import Any


ALLOWED_MODELS = {"large", "medium", "turbo"}
COMPUTE_TYPE = os.environ.get("CRISPERWHISPER_COMPUTE_TYPE", "float32")
DEFAULT_CPU_THREADS = 4

_model: Any = None
_loaded_model: str | None = None


def respond(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def configure_cpu() -> None:
    # The parent also hides CUDA, but the explicit device passed below is the
    # actual guarantee that inference cannot move to a GPU or Apple MPS device.
    try:
        available = len(os.sched_getaffinity(0))
    except AttributeError:
        available = os.cpu_count() or 1

    requested = int(
        os.environ.get("CRISPERWHISPER_CPU_THREADS", str(DEFAULT_CPU_THREADS))
        or str(DEFAULT_CPU_THREADS)
    )
    threads = max(1, min(requested if requested > 0 else DEFAULT_CPU_THREADS, available))

    # Torch delegates work to several native runtimes. Capping only Torch can
    # still let MKL/OpenBLAS/OpenMP oversubscribe the container, so keep every
    # pool on the same explicit budget before importing any numerical package.
    for variable in (
        "OMP_NUM_THREADS",
        "MKL_NUM_THREADS",
        "OPENBLAS_NUM_THREADS",
        "NUMEXPR_NUM_THREADS",
        "VECLIB_MAXIMUM_THREADS",
    ):
        os.environ[variable] = str(threads)
    os.environ["TOKENIZERS_PARALLELISM"] = "false"

    import torch

    torch.set_num_threads(threads)
    torch.set_num_interop_threads(max(1, min(threads, 2)))
    print(f"CPU inference capped at {threads} threads", file=sys.stderr, flush=True)


def get_model(model_name: str):
    global _model, _loaded_model

    if model_name not in ALLOWED_MODELS:
        raise ValueError(f"Unsupported CrisperWhisper model: {model_name}")
    if _model is not None and _loaded_model == model_name:
        return _model

    if _model is not None:
        del _model
        _model = None
        _loaded_model = None
        gc.collect()

    print(
        f"Loading CrisperWhisper 2.0 {model_name} on CPU ({COMPUTE_TYPE})...",
        file=sys.stderr,
        flush=True,
    )
    # Third-party progress output must never corrupt the stdout JSON protocol.
    with redirect_stdout(sys.stderr):
        from crisperwhisper import CrisperWhisperModel

        _model = CrisperWhisperModel(
            model_name,
            backend="transformers",
            device="cpu",
            compute_type=COMPUTE_TYPE,
        )
    _loaded_model = model_name
    return _model


def normalized_wav(audio_path: Path):
    """Convert WhatsApp's Ogg/Opus and other inputs into a portable 16 kHz WAV."""
    temp = tempfile.NamedTemporaryFile(prefix="whatsapp-hub-", suffix=".wav", delete=False)
    temp_path = Path(temp.name)
    temp.close()

    try:
        completed = subprocess.run(
            [
                os.environ.get("FFMPEG_BINARY", "ffmpeg"),
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-threads",
                "1",
                "-i",
                str(audio_path),
                "-vn",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-c:a",
                "pcm_s16le",
                str(temp_path),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if completed.returncode != 0:
            detail = completed.stderr.strip() or f"exit code {completed.returncode}"
            temp_path.unlink(missing_ok=True)
            raise RuntimeError(f"ffmpeg could not decode the audio: {detail}")
        return temp_path
    except FileNotFoundError as exc:
        temp_path.unlink(missing_ok=True)
        raise RuntimeError(
            "ffmpeg is required for local audio transcription but was not found"
        ) from exc


def handle(request: dict[str, Any]) -> dict[str, Any]:
    request_id = request.get("id")
    audio_path = Path(str(request.get("audioPath", ""))).resolve()
    model_name = str(request.get("model", ""))
    language = str(request.get("language", "en")).strip().lower()

    if not audio_path.is_file():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")
    if len(language) != 2 or not language.isalpha():
        raise ValueError("language must be a two-letter ISO 639-1 code")

    wav_path = normalized_wav(audio_path)
    try:
        model = get_model(model_name)
        with redirect_stdout(sys.stderr):
            result = model.transcribe(
                str(wav_path),
                language=language,
                mode="verbatim",
                word_timestamps=False,
            )
        return {"id": request_id, "text": result.text.strip()}
    finally:
        wav_path.unlink(missing_ok=True)


def main() -> None:
    configure_cpu()
    for raw_line in sys.stdin:
        raw_line = raw_line.strip()
        if not raw_line:
            continue

        request_id: Any = None
        try:
            request = json.loads(raw_line)
            if not isinstance(request, dict):
                raise ValueError("request must be a JSON object")
            request_id = request.get("id")
            respond(handle(request))
        except Exception as exc:  # worker must survive a bad file/request
            traceback.print_exc(file=sys.stderr)
            respond({"id": request_id, "error": f"{type(exc).__name__}: {exc}"})


if __name__ == "__main__":
    main()
