#!/usr/bin/env python3
"""
Two-pass microphone ASR helper for the Electron app.

1st pass: Streaming ZipFormer (endpointing + fast partials)
2nd pass: SenseVoice (higher-quality final result)

The script emits newline-delimited JSON (NDJSON) so Electron can forward
events to the renderer. Event types:
  - {"type": "ready"}                            # models loaded, audio loop ready
  - {"type": "devices", "devices": [...] }       # microphone list
  - {"type": "log", "message": "..."}            # informational message
  - {"type": "error", "message": "..."}          # unrecoverable error
  - {"type": "first-pass", "text": "..."}        # streaming partial text
  - {"type": "result", "stage": "second-pass",
     "segments": [{"start_time": 0.0, "end_time": 1.2, "text": "..."}]}
"""

import argparse
import json
import sys
import queue
import threading
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np

try:
    import sounddevice as sd
except ImportError:
    sys.stdout.write(
        json.dumps(
            {
                "type": "error",
                "message": "sounddevice is required. Install with: pip install sounddevice",
            }
        )
        + "\n"
    )
    sys.exit(1)

try:
    import sherpa_onnx
except ImportError:
    sys.stdout.write(
        json.dumps(
            {
                "type": "error",
                "message": "sherpa-onnx is required. Install with: pip install sherpa-onnx",
            }
        )
        + "\n"
    )
    sys.exit(1)


PROJECT_ROOT = Path(__file__).resolve().parent.parent


def emit(payload: dict):
    """Emit a single JSON line for Electron."""
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def log_devices():
    devices = sd.query_devices()
    names = [
        {
            "index": idx,
            "name": dev.get("name", ""),
            "inputs": dev.get("max_input_channels", 0),
        }
        for idx, dev in enumerate(devices)
        if dev.get("max_input_channels", 0) > 0
    ]
    emit({"type": "devices", "devices": names})
    return names


def normalize_name(name: str) -> str:
    import re

    return re.sub(r"[^a-z0-9]", "", name.lower())


def name_tokens(name: str):
    import re

    return [t for t in re.split(r"[^a-z0-9]+", name.lower()) if t]


def choose_input_device(preferred_name: str, preferred_index: int) -> int:
    devices = sd.query_devices()
    default_idx = sd.default.device[0]
    fallback_idx = next(
        (i for i, d in enumerate(devices) if d.get("max_input_channels", 0) > 0),
        None,
    )

    name_idx = None
    if preferred_name:
        wanted_norm = normalize_name(preferred_name)
        wanted_tokens = name_tokens(preferred_name)
        for idx, dev in enumerate(devices):
            if dev.get("max_input_channels", 0) < 1:
                continue
            dev_name = dev.get("name", "")
            norm = normalize_name(dev_name)
            tokens = name_tokens(dev_name)
            if wanted_norm and (wanted_norm in norm or norm in wanted_norm):
                name_idx = idx
                break
            if wanted_tokens and all(t in tokens for t in wanted_tokens):
                name_idx = idx
                break

    if name_idx is not None:
        emit(
            {
                "type": "log",
                "message": f"Using microphone by name: {devices[name_idx]['name']} (index {name_idx})",
            }
        )
        return name_idx

    if preferred_name:
        emit({"type": "log", "message": f"Preferred microphone name not found: {preferred_name}"})

    if preferred_index is not None and 0 <= preferred_index < len(devices):
        dev = devices[preferred_index]
        if dev.get("max_input_channels", 0) > 0:
            emit(
                {
                    "type": "log",
                    "message": f"Using microphone by index fallback: {dev.get('name','')} (index {preferred_index})",
                }
            )
            return preferred_index

    if default_idx is not None and default_idx >= 0:
        emit(
            {"type": "log", "message": f"Using default microphone: {devices[default_idx]['name']} (index {default_idx})"}
        )
        return default_idx

    return fallback_idx if fallback_idx is not None else 0


def assert_file(path: str, flag: str):
    p = Path(path)
    if not p.is_file():
        raise ValueError(f"{flag} not found: {path}")
    return str(p)


def guess_silero(path: str) -> Path:
    """Resolve Silero VAD path; default to project root."""
    if path:
        return Path(path).expanduser()
    candidate = PROJECT_ROOT / "silero_vad.onnx"
    return candidate


def get_args():
    parser = argparse.ArgumentParser(formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    parser.add_argument("--first-encoder", default="", type=str, help="Path to streaming ZipFormer encoder ONNX")
    parser.add_argument("--first-decoder", default="", type=str, help="Path to streaming ZipFormer decoder ONNX")
    parser.add_argument("--first-joiner", default="", type=str, help="Path to streaming ZipFormer joiner ONNX")
    parser.add_argument("--first-tokens", default="", type=str, help="tokens.txt for the 1st pass model")
    parser.add_argument("--first-decoding-method", default="greedy_search", type=str, help="greedy_search or modified_beam_search")
    parser.add_argument("--first-max-active-paths", default=4, type=int, help="Only for modified_beam_search")
    parser.add_argument("--num-threads-first", default=2, type=int, help="Threads for 1st pass")
    parser.add_argument("--provider-first", default="cpu", type=str, help="Inference provider for 1st pass")

    parser.add_argument("--second-model", required=True, type=str, help="SenseVoice model path (model.onnx or model.int8.onnx)")
    parser.add_argument("--second-tokens", required=True, type=str, help="tokens.txt for SenseVoice")
    parser.add_argument("--num-threads-second", default=4, type=int, help="Threads for 2nd pass")
    parser.add_argument("--provider-second", default="cpu", type=str, help="Inference provider for 2nd pass")

    parser.add_argument("--tail-padding", default=4000, type=int, help="Samples kept as right context for the next segment")
    parser.add_argument("--sample-rate", default=16000, type=int, help="Audio sample rate")
    parser.add_argument("--device", default="", type=str, help="Preferred microphone name fragment")
    parser.add_argument("--device-index", default=-1, type=int, help="Preferred microphone index")
    parser.add_argument("--chunk-duration", default=0.1, type=float, help="Seconds per microphone read (smaller = lower latency)")
    parser.add_argument("--disable-endpoint", action="store_true", help="Disable endpoint detection for 1st pass (requires VAD)")
    parser.add_argument("--silero-vad-model", default="", type=str, help="Enable VAD segmentation by providing silero_vad.onnx path")
    parser.add_argument("--vad-threshold", default=0.5, type=float, help="Silero VAD speech threshold (0~1)")
    parser.add_argument("--vad-min-silence", default=0.5, type=float, help="Silence duration to close a segment (seconds)")
    parser.add_argument("--vad-min-speech", default=0.25, type=float, help="Minimum speech duration to output (seconds)")
    parser.add_argument("--vad-max-speech", default=8.0, type=float, help="Maximum speech duration before forcing a cut (seconds)")
    parser.add_argument("--wav-input", default="", type=str, help="If provided, run a single-pass decode on this 16k mono WAV and exit")
    parser.add_argument("--manual-mode", action="store_true", help="Push-to-talk mode: record from mic until 'stop' is received on stdin, then run 2nd pass only")
    parser.add_argument("--manual-realtime", action="store_true", help="Manual mode with real-time VAD+2pass: while holding hotkey, process 1pass -> VAD -> 2pass -> paste for each speech segment")
    parser.add_argument("--start-paused", action="store_true", help="Start microphone capture paused until 'start' is received on stdin (streaming mode)")
    return parser.parse_args()

#  recognizer = sherpa_onnx.OnlineRecognizer.from_transducer(
#         tokens=args.first_tokens,
#         encoder=args.first_encoder,
#         decoder=args.first_decoder,
#         joiner=args.first_joiner,
#         num_threads=1,
#         sample_rate=16000,
#         feature_dim=80,
#         decoding_method=args.first_decoding_method,
#         max_active_paths=args.first_max_active_paths,
#         provider=args.provider,
#         enable_endpoint_detection=True,
#         rule1_min_trailing_silence=2.4,
#         rule2_min_trailing_silence=1.2,
#         rule3_min_utterance_length=20,
#     )

def create_first_pass(args) -> sherpa_onnx.OnlineRecognizer:
    return sherpa_onnx.OnlineRecognizer.from_transducer(
        tokens=assert_file(args.first_tokens, "--first-tokens"),
        encoder=assert_file(args.first_encoder, "--first-encoder"),
        decoder=assert_file(args.first_decoder, "--first-decoder"),
        joiner=assert_file(args.first_joiner, "--first-joiner"),
        num_threads=max(1, args.num_threads_first),
        sample_rate=args.sample_rate,
        feature_dim=80,
        decoding_method=args.first_decoding_method,
        max_active_paths=args.first_max_active_paths,
        provider=args.provider_first,
        enable_endpoint_detection=not args.disable_endpoint,
        rule1_min_trailing_silence=1.8,
        rule2_min_trailing_silence=0.8,
        rule3_min_utterance_length=8.0,
    )


def create_second_pass(args) -> sherpa_onnx.OfflineRecognizer:
    return sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=assert_file(args.second_model, "--second-model"),
        tokens=assert_file(args.second_tokens, "--second-tokens"),
        num_threads=max(1, args.num_threads_second),
        provider=args.provider_second,
        use_itn=True,
        debug=False,
    )


def create_vad(args) -> Optional[Tuple[sherpa_onnx.VoiceActivityDetector, int]]:
    try:
        model_path = guess_silero(args.silero_vad_model)
        if not model_path.is_file():
            if args.silero_vad_model:
                raise ValueError(f"Silero VAD model not found: {model_path}")
            # No model provided and default path missing -> skip VAD
            emit({"type": "log", "message": "VAD not enabled (silero_vad.onnx not found)"})
            return None
        
        emit({"type": "log", "message": f"Using VAD model: {model_path}"})

        vad_config = sherpa_onnx.VadModelConfig()
        vad_config.sample_rate = args.sample_rate
        vad_config.silero_vad.model = str(model_path)
        vad_config.silero_vad.threshold = args.vad_threshold
        vad_config.silero_vad.min_silence_duration = args.vad_min_silence
        vad_config.silero_vad.min_speech_duration = args.vad_min_speech
        vad_config.silero_vad.max_speech_duration = args.vad_max_speech

        if not vad_config.validate():
            emit({"type": "log", "message": "Invalid VAD configuration, fallback to endpointing"})
            return None

        vad = sherpa_onnx.VoiceActivityDetector(vad_config, buffer_size_in_seconds=120)
        emit(
            {
                "type": "log",
                "message": f"Silero VAD enabled (thr={args.vad_threshold}, min_sil={args.vad_min_silence}s, min_speech={args.vad_min_speech}s, max_speech={args.vad_max_speech}s)",
            }
        )
        return vad, vad_config.silero_vad.window_size
    except Exception as exc:  # pylint: disable=broad-except
        emit({"type": "log", "message": f"VAD init failed, fallback to endpointing: {exc}"})
        return None


def run_second_pass(recognizer: sherpa_onnx.OfflineRecognizer, samples: np.ndarray, sample_rate: int) -> str:
    if samples.size == 0:
        return ""
    stream = recognizer.create_stream()
    stream.accept_waveform(sample_rate, samples)
    recognizer.decode_stream(stream)
    return (stream.result.text or "").strip()


def read_wav_float_mono(path: Path, expected_sr: int) -> np.ndarray:
    import wave

    with wave.open(str(path), "rb") as wf:
        num_channels = wf.getnchannels()
        sampwidth = wf.getsampwidth()
        sr = wf.getframerate()
        nframes = wf.getnframes()
        if num_channels != 1:
            raise ValueError(f"WAV must be mono, got {num_channels} channels")
        if sr != expected_sr:
            raise ValueError(f"WAV sample rate must be {expected_sr}, got {sr}")
        if sampwidth not in (2, 4):
            raise ValueError(f"Unsupported sample width: {sampwidth} bytes")
        raw = wf.readframes(nframes)

    if sampwidth == 2:
        data = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    else:
        data = np.frombuffer(raw, dtype=np.int32).astype(np.float32) / 2147483648.0
    return data


def process_wav_input(args, first_pass, second_pass, vad_bundle):
    wav_path = Path(args.wav_input).expanduser()
    if not wav_path.is_file():
        emit({"type": "error", "message": f"WAV file not found: {wav_path}"})
        sys.exit(1)

    emit({"type": "ready"})
    emit({"type": "log", "message": f"Processing WAV (push-to-talk): {wav_path}"})

    try:
        samples = read_wav_float_mono(wav_path, args.sample_rate)
    except Exception as exc:  # pylint: disable=broad-except
        emit({"type": "error", "message": f"Failed to read WAV: {exc}"})
        sys.exit(1)

    vad = None
    vad_window_size = None
    if vad_bundle:
        vad, vad_window_size = vad_bundle

    def decode_segment(segment_audio: np.ndarray, start_sample: int):
        """Run 2nd pass for a segment and emit result."""
        duration = len(segment_audio) / args.sample_rate
        start_time = max(0.0, start_sample / args.sample_rate)
        end_time = start_time + duration
        text = run_second_pass(second_pass, segment_audio, args.sample_rate)
        emit(
            {
                "type": "result",
                "stage": "second-pass",
                "segments": [
                    {
                        "start_time": round(start_time, 2),
                        "end_time": round(end_time, 2),
                        "text": text,
                        "speaker": "PushToTalk",
                    }
                ],
            }
        )

    if vad:
        try:
            offset = 0
            window = vad_window_size or max(1, len(samples))
            while offset < len(samples):
                end = min(offset + window, len(samples))
                vad.accept_waveform(samples[offset:end])
                offset = end
                while not vad.empty():
                    segment = vad.front
                    segment_audio = np.asarray(segment.samples, dtype=np.float32).reshape(-1)
                    decode_segment(segment_audio, segment.start)
                    vad.pop()
        except Exception as exc:  # pylint: disable=broad-except
            emit({"type": "error", "message": f"VAD processing failed: {exc}"})
            sys.exit(1)
    else:
        decode_segment(samples, 0)

    emit({"type": "complete", "message": "Push-to-talk WAV decoding done"})
    sys.exit(0)


def run_manual_mode(args, second_pass, first_pass: Optional[sherpa_onnx.OnlineRecognizer] = None, vad_bundle=None):
    emit({"type": "ready"})

    realtime_mode = args.manual_realtime
    emit({"type": "log", "message": f"[DEBUG] run_manual_mode: realtime_mode={realtime_mode}, vad_bundle={vad_bundle is not None}"})
    if realtime_mode:
        emit({"type": "log", "message": "Manual push-to-talk mode (REALTIME VAD+2pass): send 'start'/'stop' via stdin; 'quit' to exit"})
        if not vad_bundle:
            emit({"type": "log", "message": "Warning: realtime mode works best with VAD enabled (--silero-vad-model)"})
    else:
        emit({"type": "log", "message": "Manual push-to-talk mode (LEGACY): send 'start'/'stop' via stdin; 'quit' to exit"})

    record_event = threading.Event()
    exit_event = threading.Event()
    buffer: List[np.ndarray] = []
    buffer_lock = threading.Lock()
    stream_lock = threading.Lock()
    stream_handle: Optional[sd.InputStream] = None
    first_stream = first_pass.create_stream() if first_pass else None
    last_partial = ""
    device_index = choose_input_device(args.device, args.device_index)
    blocksize = max(1, int(args.chunk_duration * args.sample_rate))
    total_samples_seen = 0
    segment_start_sample = 0

    # VAD for realtime mode
    vad = None
    vad_window_size = None
    if realtime_mode and vad_bundle:
        vad, vad_window_size = vad_bundle
        emit({"type": "log", "message": f"[DEBUG] VAD initialized: vad={vad is not None}, window_size={vad_window_size}"})
        emit({"type": "log", "message": "VAD enabled for realtime manual mode"})

    def flush_and_decode():
        """Legacy mode: flush all buffered audio at stop for single 2pass decode."""
        with buffer_lock:
            samples = np.concatenate(buffer) if buffer else np.zeros(0, dtype=np.float32)
            buffer.clear()
        if samples.size == 0:
            emit({"type": "log", "message": "No audio captured in this segment"})
            return
        if first_pass and first_stream:
            try:
                first_pass.reset(first_stream)
            except Exception:
                pass
        emit({"type": "log", "message": f"Captured {len(samples)/args.sample_rate:.2f}s audio, decoding (2nd pass only)..."})
        text = run_second_pass(second_pass, samples, args.sample_rate)
        emit(
            {
                "type": "result",
                "stage": "second-pass",
                "segments": [
                    {
                        "start_time": 0.0,
                        "end_time": round(len(samples) / args.sample_rate, 2),
                        "text": text,
                        "speaker": "PushToTalk",
                    }
                ],
            }
        )
        emit({"type": "log", "message": "Second-pass decode finished"})

    def decode_segment(segment_audio: np.ndarray, start_sample: int):
        """Realtime mode: decode a VAD-detected segment immediately."""
        if segment_audio.size == 0:
            return
        duration = len(segment_audio) / args.sample_rate
        start_time = max(0.0, start_sample / args.sample_rate)
        end_time = start_time + duration
        text = run_second_pass(second_pass, segment_audio, args.sample_rate)
        emit(
            {
                "type": "result",
                "stage": "second-pass",
                "segments": [
                    {
                        "start_time": round(start_time, 2),
                        "end_time": round(end_time, 2),
                        "text": text,
                        "speaker": "PushToTalk",
                    }
                ],
            }
        )
        emit({"type": "log", "message": f"Realtime 2pass: {len(segment_audio)/args.sample_rate:.2f}s -> '{text}'"})

    def audio_callback(indata, frames, time_info, status):  # pylint: disable=unused-argument
        nonlocal last_partial, total_samples_seen, segment_start_sample, vad
        if record_event.is_set():
            samples_copy = indata.copy().reshape(-1)
            with buffer_lock:
                buffer.append(samples_copy)

            if realtime_mode and vad:
                # Realtime VAD mode: feed to VAD and process segments immediately
                try:
                    vad.accept_waveform(samples_copy)
                    while not vad.empty():
                        segment = vad.front
                        segment_audio = np.asarray(segment.samples, dtype=np.float32).reshape(-1)
                        emit({"type": "log", "message": f"[DEBUG] VAD segment detected: {len(segment_audio)/args.sample_rate:.2f}s"})
                        decode_segment(segment_audio, segment.start)
                        vad.pop()
                except Exception as exc:  # pylint: disable=broad-except
                    emit({"type": "log", "message": f"VAD processing failed: {exc}"})
            else:
                # Log why VAD is not processing
                if realtime_mode and not vad:
                    # Only log once in a while to avoid spamming
                    if total_samples_seen % (args.sample_rate * 5) == 0:  # Every 5 seconds
                        emit({"type": "log", "message": "[DEBUG] realtime_mode=True but vad is None"})

            if first_pass and first_stream is not None:
                try:
                    first_stream.accept_waveform(args.sample_rate, samples_copy)
                    while first_pass.is_ready(first_stream):
                        first_pass.decode_stream(first_stream)
                    raw_partial = first_pass.get_result(first_stream)
                    partial = getattr(raw_partial, "text", raw_partial)
                    partial = str(partial or "").lower().strip()
                    if partial != last_partial:
                        emit({"type": "first-pass", "text": partial})
                        last_partial = partial
                except Exception as exc:  # pylint: disable=broad-except
                    emit({"type": "log", "message": f"First-pass update failed: {exc}"})

            total_samples_seen += len(samples_copy)

    def stop_stream():
        nonlocal stream_handle
        with stream_lock:
            if stream_handle is None:
                return
            try:
                stream_handle.stop()
                stream_handle.close()
                emit({"type": "log", "message": "Microphone stream stopped"})
            except Exception as exc:  # pylint: disable=broad-except
                emit({"type": "log", "message": f"Failed to stop microphone stream: {exc}"})
            stream_handle = None

    def start_stream():
        nonlocal stream_handle
        with stream_lock:
            if stream_handle is not None:
                return True
            try:
                stream_handle = sd.InputStream(
                    samplerate=args.sample_rate,
                    channels=1,
                    dtype="float32",
                    device=device_index,
                    blocksize=blocksize,
                    callback=audio_callback,
                )
                stream_handle.start()
                emit({"type": "log", "message": "Microphone stream started for push-to-talk"})
                return True
            except Exception as exc:  # pylint: disable=broad-except
                stream_handle = None
                record_event.clear()
                emit({"type": "error", "message": f"Failed to start microphone: {exc}"})
                return False

    def stdin_listener():
        nonlocal total_samples_seen, segment_start_sample, first_stream, last_partial, vad
        for line in sys.stdin:
            cmd = line.strip().lower()
            if cmd == "start":
                with buffer_lock:
                    buffer.clear()
                total_samples_seen = 0
                segment_start_sample = 0
                if first_pass:
                    try:
                        first_stream = first_pass.create_stream()
                        last_partial = ""
                    except Exception as exc:  # pylint: disable=broad-except
                        emit({"type": "log", "message": f"Failed to reset first-pass stream: {exc}"})
                if realtime_mode and vad:
                    # Recreate VAD for new recording session
                    try:
                        vad_config = sherpa_onnx.VadModelConfig()
                        vad_config.sample_rate = args.sample_rate
                        vad_config.silero_vad.model = str(guess_silero(args.silero_vad_model))
                        vad_config.silero_vad.threshold = args.vad_threshold
                        vad_config.silero_vad.min_silence_duration = args.vad_min_silence
                        vad_config.silero_vad.min_speech_duration = args.vad_min_speech
                        vad_config.silero_vad.max_speech_duration = args.vad_max_speech
                        vad = sherpa_onnx.VoiceActivityDetector(vad_config, buffer_size_in_seconds=120)
                        emit({"type": "log", "message": "VAD reset for new recording session"})
                    except Exception as exc:  # pylint: disable=broad-except
                        emit({"type": "log", "message": f"Failed to reset VAD: {exc}"})
                if start_stream():
                    record_event.set()
                    emit({"type": "log", "message": "Recording started"})
            elif cmd == "stop":
                if record_event.is_set():
                    record_event.clear()
                    if realtime_mode:
                        # Realtime mode: VAD segments already processed, just flush any remaining
                        if vad:
                            try:
                                vad.flush()
                                while not vad.empty():
                                    segment = vad.front
                                    segment_audio = np.asarray(segment.samples, dtype=np.float32).reshape(-1)
                                    decode_segment(segment_audio, segment.start)
                                    vad.pop()
                            except Exception as exc:  # pylint: disable=broad-except
                                emit({"type": "log", "message": f"VAD flush failed: {exc}"})
                        emit({"type": "log", "message": "Recording stopped (realtime mode)"})
                    else:
                        # Legacy mode: decode all buffered audio at once
                        flush_and_decode()
                        emit({"type": "log", "message": "Recording stopped"})
                else:
                    emit({"type": "log", "message": "Stop received but not recording; closing microphone if open"})
                stop_stream()
            elif cmd in ("quit", "exit"):
                exit_event.set()
                record_event.clear()
                stop_stream()
                break
        exit_event.set()

    listener_thread = threading.Thread(target=stdin_listener, daemon=True)
    listener_thread.start()

    try:
        while not exit_event.is_set():
            exit_event.wait(timeout=0.05)
    except Exception as exc:  # pylint: disable=broad-except
        emit({"type": "error", "message": f"Recording failed: {exc}"})
        sys.exit(1)
    finally:
        if record_event.is_set():
            record_event.clear()
            flush_and_decode()
        stop_stream()

    emit({"type": "complete", "message": "Manual push-to-talk session ended"})
    sys.exit(0)


def main():
    args = get_args()
    if args.sample_rate != 16000:
        emit({"type": "error", "message": "Only 16 kHz sample_rate is supported"})
        sys.exit(1)

    try:
        emit({"type": "log", "message": "Creating recognizers. Please wait..."})
        emit({"type": "log", "message": f"Args: {json.dumps(vars(args), ensure_ascii=False)}"})
        emit({"type": "log", "message": f"===== Python Args Summary ====="})
        emit({"type": "log", "message": f"manual_mode: {args.manual_mode}"})
        emit({"type": "log", "message": f"manual_realtime: {args.manual_realtime}"})
        emit({"type": "log", "message": f"device: {args.device}"})
        emit({"type": "log", "message": f"sample_rate: {args.sample_rate}"})
        emit({"type": "log", "message": f"============================"})
        second_pass = create_second_pass(args)
        first_pass = create_first_pass(args)
        vad_bundle = create_vad(args)
    except Exception as exc:  # pylint: disable=broad-except
        emit({"type": "error", "message": f"Failed to create recognizers: {exc}"})
        sys.exit(1)

    if args.wav_input:
        process_wav_input(args, first_pass, second_pass, vad_bundle)
        return

    # Manual push-to-talk mode has its own dedicated flow
    if args.manual_mode:
        run_manual_mode(args, second_pass, first_pass, vad_bundle)
        return

    if args.disable_endpoint and not vad_bundle:
        emit({"type": "error", "message": "Endpoint detection is disabled but no VAD is enabled; cannot segment audio."})
        sys.exit(1)

    emit(
        {
            "type": "log",
            "message": "Two-pass ASR initialized (ZipFormer streaming -> SenseVoice)",
        }
    )
    emit(
        {
            "type": "log",
            "message": f"1st pass threads: {args.num_threads_first}, 2nd pass threads: {args.num_threads_second}",
        }
    )

    devices = log_devices()
    if not devices:
        emit({"type": "error", "message": "No microphone devices found"})
        sys.exit(1)

    device_index = choose_input_device(args.device, args.device_index)
    samples_per_read = max(1, int(args.chunk_duration * args.sample_rate))
    carry_over = np.zeros(0, dtype=np.float32)
    vad = None
    vad_window_size = None
    if vad_bundle:
        vad, vad_window_size = vad_bundle
    current_chunks: List[np.ndarray] = []
    last_partial = ""
    total_samples_seen = 0
    stream = first_pass.create_stream()
    record_event = threading.Event()
    exit_event = threading.Event()
    state_lock = threading.Lock()
    mode_lock = threading.Lock()
    mode_changed = threading.Event()
    mode_state = "manual" if args.manual_mode else "auto"
    realtime_manual = args.manual_realtime
    emit({"type": "log", "message": f"===== Mode Configuration ====="})
    emit({"type": "log", "message": f"mode_state: {mode_state}"})
    emit({"type": "log", "message": f"realtime_manual: {realtime_manual}"})
    emit({"type": "log", "message": f"============================"})
    if mode_state == "manual":
        emit({"type": "log", "message": f"Manual mode: realtime={realtime_manual}"})
    if mode_state == "auto" and not args.start_paused:
        record_event.set()
    else:
        emit({"type": "log", "message": "Capture is paused; waiting for 'start' command"})

    # Offload 2nd-pass decoding to a worker to avoid blocking the audio loop
    decode_queue: "queue.Queue[Tuple[np.ndarray, float, float]]" = queue.Queue(maxsize=8)

    def get_mode() -> str:
        with mode_lock:
            return mode_state

    def request_mode(new_mode: str):
        nonlocal mode_state
        if new_mode not in ("auto", "manual"):
            return
        with mode_lock:
            if mode_state == new_mode:
                return
            mode_state = new_mode
            mode_changed.set()
        emit({"type": "log", "message": f"Mode switch requested: {new_mode}"})
        stop_audio_stream("mode-switch")

    def decode_worker():
        while True:
            task = decode_queue.get()
            if task is None:
                decode_queue.task_done()
                break
            try:
                second_audio, start_time, end_time = task
                emit(
                  {
                      "type": "log",
                      "message": f"Second-pass decoding {len(second_audio)/args.sample_rate:.2f}s [{start_time:.2f},{end_time:.2f}]",
                  }
                )
                second_text = run_second_pass(second_pass, second_audio, args.sample_rate)
                emit(
                    {
                        "type": "result",
                        "stage": "second-pass",
                        "segments": [
                            {
                                "start_time": round(start_time, 2),
                                "end_time": round(end_time, 2),
                                "text": second_text,
                                "speaker": "Microphone",
                            }
                        ],
                    }
                )
            except Exception as exc:  # pylint: disable=broad-except
                emit({"type": "error", "message": f"Second-pass decode failed: {exc}"})
            finally:
                decode_queue.task_done()

    decoder_thread = threading.Thread(target=decode_worker, daemon=True)
    decoder_thread.start()

    def switch_device(target: str):
        """Switch microphone without restarting models."""
        nonlocal device_index
        target = (target or "").strip()
        name = ""
        idx = -1
        if target:
            try:
                idx = int(target)
            except Exception:
                name = target
        try:
            new_idx = choose_input_device(name, idx)
        except Exception as exc:  # pylint: disable=broad-except
            emit({"type": "log", "message": f"Switch device failed: {exc}"})
            return

        devices = sd.query_devices()
        if new_idx is None or new_idx < 0 or new_idx >= len(devices):
            emit({"type": "log", "message": f"Device not found for target '{target}'"})
            return
        if new_idx == device_index:
            emit({"type": "log", "message": f"Device unchanged: {devices[new_idx]['name']} (index {new_idx})"})
            return

        device_index = new_idx
        stop_audio_stream("device-switch")
        flush_current_segment("device-switch")
        emit({"type": "log", "message": f"Microphone switched to: {devices[new_idx].get('name','')} (index {new_idx})"})

    def reset_state():
        nonlocal carry_over, current_chunks, last_partial, total_samples_seen, stream, vad, vad_window_size
        with state_lock:
            carry_over = np.zeros(0, dtype=np.float32)
            current_chunks = []
            last_partial = ""
            total_samples_seen = 0
            first_pass.reset(stream)
            if vad_bundle:
                vad, vad_window_size = create_vad(args) or (None, None)
        emit({"type": "log", "message": "Capture state reset"})

    def flush_current_segment(reason: str = "stop"):
        nonlocal current_chunks
        with state_lock:
            if not current_chunks:
                return
            chunk_audio = np.concatenate(current_chunks)
            start_sample = max(0, total_samples_seen - len(chunk_audio))
            emit({"type": "log", "message": f"Flushing buffered audio on {reason} ({len(chunk_audio)/args.sample_rate:.2f}s)"})
            finalize_segment(chunk_audio, start_sample)
            current_chunks = []

    def finalize_segment(segment_audio: np.ndarray, start_sample: int):
        """Run the 2nd pass for a completed speech segment and reset state."""
        nonlocal carry_over, current_chunks, last_partial

        emit({"type": "first-pass", "text": ""})
        last_partial = ""

        chunk_audio = segment_audio if segment_audio is not None else np.zeros(0, dtype=np.float32)
        if chunk_audio.size > 0:
            if get_mode() == "manual":
                combined = chunk_audio
                next_carry = np.zeros(0, dtype=np.float32)
                second_audio = combined
            else:
                combined = np.concatenate([carry_over, chunk_audio]) if carry_over.size > 0 else chunk_audio
                keep_tail = max(0, args.tail_padding)
                if keep_tail > 0 and combined.size > keep_tail:
                    next_carry = combined[-keep_tail:]
                    # 为当前段解码时去掉预留给下一段的 tail，避免重复解码
                    second_audio = combined
                else:
                    next_carry = combined if keep_tail > 0 else np.zeros(0, dtype=np.float32)
                    second_audio = combined

            duration = len(chunk_audio) / args.sample_rate
            start_time = max(0.0, start_sample / args.sample_rate)
            end_time = start_time + duration

            try:
                decode_queue.put_nowait((second_audio, start_time, end_time))
            except queue.Full:
                emit({"type": "log", "message": "Second-pass queue full, dropping segment"})
        else:
            next_carry = np.zeros(0, dtype=np.float32)

        carry_over = next_carry
        current_chunks = []
        first_pass.reset(stream)

    def stdin_listener():
        for line in sys.stdin:
            cmd = line.strip().lower()
            if cmd == "start":
                reset_state()
                record_event.set()
                emit({"type": "log", "message": "Capture started (start command received)"})
            elif cmd == "stop":
                record_event.clear()
                if realtime_manual and vad:
                    # Flush any remaining VAD segments
                    try:
                        vad.flush()
                        while not vad.empty():
                            segment = vad.front
                            segment_audio = np.asarray(segment.samples, dtype=np.float32).reshape(-1)
                            emit(
                                {
                                    "type": "log",
                                    "message": f"[REALTIME MANUAL] Flushing VAD segment: {len(segment_audio)/args.sample_rate:.2f}s",
                                }
                            )
                            finalize_segment(segment_audio, segment.start)
                            vad.pop()
                    except Exception as exc:  # pylint: disable=broad-except
                        emit({"type": "log", "message": f"VAD flush failed: {exc}"})
                else:
                    flush_current_segment("stop")
                emit({"type": "log", "message": "Capture stopped (models kept alive)"})
            elif cmd in ("mode manual", "manual"):
                record_event.clear()
                flush_current_segment("mode-switch")
                request_mode("manual")
            elif cmd in ("mode auto", "auto"):
                record_event.clear()
                flush_current_segment("mode-switch")
                request_mode("auto")
            elif cmd.startswith("device"):
                payload = cmd.split(" ", 1)[1] if " " in cmd else ""
                switch_device(payload)
            elif cmd in ("quit", "exit"):
                exit_event.set()
                record_event.clear()
                break
        exit_event.set()

    listener_thread = threading.Thread(target=stdin_listener, daemon=True)
    listener_thread.start()

    emit({"type": "ready"})
    emit({"type": "log", "message": "Started! Speak into the microphone..."})

    stream_handle: Optional[sd.InputStream] = None

    def stop_audio_stream(reason: str = "idle"):
        """Close the microphone stream so the OS stops listening."""
        nonlocal stream_handle
        if stream_handle is None:
            return
        try:
            stream_handle.stop()
            stream_handle.close()
            emit({"type": "log", "message": f"Microphone stream closed ({reason})"})
        except Exception as exc:  # pylint: disable=broad-except
            emit({"type": "log", "message": f"Failed to close microphone stream: {exc}"})
        stream_handle = None

    def ensure_audio_stream() -> bool:
        """Lazily open the microphone stream only when capturing."""
        nonlocal stream_handle
        if stream_handle is not None:
            return True
        try:
            stream_handle = sd.InputStream(
                samplerate=args.sample_rate,
                channels=1,
                dtype="float32",
                device=device_index,
                blocksize=samples_per_read,
            )
            stream_handle.start()
            emit({"type": "log", "message": "Microphone stream opened"})
            return True
        except Exception as exc:  # pylint: disable=broad-except
            stream_handle = None
            record_event.clear()
            emit({"type": "error", "message": f"Failed to start microphone stream: {exc}"})
            return False

    energy_log_last_ts = 0.0
    try:
        while not exit_event.is_set():
            if mode_changed.is_set():
                mode_changed.clear()
                reset_state()
                stop_audio_stream("mode-switch")
                emit({"type": "log", "message": f"Mode switched to {get_mode()}; send 'start' to begin capture"})
                continue

            if not record_event.is_set():
                stop_audio_stream("paused")
                exit_event.wait(timeout=0.05)
                continue

            if not ensure_audio_stream():
                exit_event.wait(timeout=0.2)
                continue

            data, _ = stream_handle.read(samples_per_read)
            emit({"type": "log", "message": f"Mic chunk read: {len(data)} samples"})
            samples = data.reshape(-1)
            total_samples_seen += len(samples)

            # 简单能量监测，帮助判断是否采到声音
            now_ts = total_samples_seen / args.sample_rate
            if now_ts - energy_log_last_ts >= 0.8:
                energy_log_last_ts = now_ts
                if samples.size:
                    rms = float(np.sqrt(np.mean(samples ** 2)))
                    rms_db = 20 * np.log10(max(rms, 1e-6))
                    emit({"type": "log", "message": f"Mic RMS {rms_db:.1f} dBFS"})

            stream.accept_waveform(args.sample_rate, samples)
            current_chunks.append(samples)

            # 先把当前缓存的音频解码出来，再做端点判定（与官方示例保持一致）
            while first_pass.is_ready(stream):
                first_pass.decode_stream(stream)

            # 更新第一遍文本（使用最新解码结果）
            raw_partial = first_pass.get_result(stream)
            partial = getattr(raw_partial, "text", raw_partial)
            partial = str(partial or "").lower().strip()

            if partial != last_partial:
                emit({"type": "first-pass", "text": partial})
                last_partial = partial

            current_mode = get_mode()

            # 当 partial 为空且没有 VAD 时，至少每 0.8s 发一次 keepalive，帮助 UI 判断流是否活着
            # 避免“无日志以为挂掉”
            if current_mode == "auto" and not partial and not vad and (total_samples_seen % int(args.sample_rate * 0.8) == 0):
                emit({"type": "log", "message": "Keepalive: streaming, waiting for speech..."})

            if current_mode == "auto":
                if vad:
                    vad_segmented = False
                    try:
                        # 使用 VAD 分割语音段
                        window = vad_window_size or len(samples)
                        offset = 0
                        while offset < len(samples):
                            end = min(offset + window, len(samples))
                            vad.accept_waveform(samples[offset:end])
                            offset = end

                            while not vad.empty():
                                segment = vad.front
                                segment_start = segment.start  # in samples
                                segment_audio = np.asarray(segment.samples, dtype=np.float32).reshape(-1)
                                emit(
                                    {
                                        "type": "log",
                                        "message": f"VAD segment detected, {len(segment_audio)/args.sample_rate:.2f}s, start={segment_start/args.sample_rate:.2f}s",
                                    }
                                )
                                finalize_segment(segment_audio, segment_start)
                                vad.pop()
                                vad_segmented = True
                    except Exception as exc:  # pylint: disable=broad-except
                        emit({"type": "log", "message": f"VAD processing error, disabling VAD: {exc}"})
                        vad = None
                    if vad_segmented:
                        continue
                    # VAD 未切出段时，回退到端点检测，避免漏段

                # 端点检测放在获取最新 partial 之后，避免用到旧结果
                is_endpoint = first_pass.is_endpoint(stream)

                if not is_endpoint:
                    # 跳过非端点帧，便于调试时在日志中观察判定过程
                    continue

                # Endpoint detected - 获取最终的 partial 用于第二遍
                emit({"type": "log", "message": f"Endpoint detected with partial='{partial}'"})
                chunk_audio = np.concatenate(current_chunks) if current_chunks else np.zeros(0, dtype=np.float32)
                start_sample = max(0, total_samples_seen - len(chunk_audio))
                emit({"type": "log", "message": f"Endpoint detected, flushing {len(chunk_audio)/args.sample_rate:.2f}s audio"})
                finalize_segment(chunk_audio, start_sample)
            else:
                # Manual mode
                if realtime_manual and vad:
                    # Realtime manual mode: use VAD to segment and process immediately
                    vad_segmented = False
                    try:
                        window = vad_window_size or len(samples)
                        offset = 0
                        while offset < len(samples):
                            end = min(offset + window, len(samples))
                            vad.accept_waveform(samples[offset:end])
                            offset = end

                            while not vad.empty():
                                segment = vad.front
                                segment_start = segment.start
                                segment_audio = np.asarray(segment.samples, dtype=np.float32).reshape(-1)
                                emit(
                                    {
                                        "type": "log",
                                        "message": f"[REALTIME MANUAL] VAD segment: {len(segment_audio)/args.sample_rate:.2f}s",
                                    }
                                )
                                finalize_segment(segment_audio, segment_start)
                                vad.pop()
                                vad_segmented = True
                    except Exception as exc:  # pylint: disable=broad-except
                        emit({"type": "log", "message": f"VAD processing error in realtime manual mode: {exc}"})
                        vad = None
                # Legacy manual mode: no auto-segmenting, wait for stop command
    except KeyboardInterrupt:
        emit({"type": "complete", "message": "Interrupted by user"})
    except Exception as exc:  # pylint: disable=broad-except
        emit({"type": "error", "message": f"Runtime error: {exc}"})
        sys.exit(1)
    finally:
        try:
            decode_queue.put_nowait(None)
        except Exception:
            pass
        decoder_thread.join(timeout=2)
        stop_audio_stream("shutdown")


if __name__ == "__main__":
    main()
