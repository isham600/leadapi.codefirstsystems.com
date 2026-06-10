#!/usr/bin/env python3
"""
FreePBX AGI Script: AI Conversation Handler
Deploy to: /var/lib/asterisk/agi-bin/ai_conv.py
chmod +x /var/lib/asterisk/agi-bin/ai_conv.py
chown asterisk:asterisk /var/lib/asterisk/agi-bin/ai_conv.py

Called by AMI Originate:
  Application: AGI
  Data: ai_conv.py,{detail_id},{api_base_url}

Flow:
  1. Play greeting audio
  2. Record caller's speech (silence detection)
  3. POST audio to API server /phone-ivr/ai/conversation/turn
  4. API returns response audio filename (already SCP'd to sounds dir)
  5. Play response, loop for max_turns
  6. POST final result to callback
"""

import sys
import os
import json
import time
import urllib.request
import urllib.parse

# ── Args ──────────────────────────────────────────────────────
detail_id    = sys.argv[1] if len(sys.argv) > 1 else "0"
api_base_url = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:3003"

config_path  = f"/tmp/ai_call_{detail_id}_config.json"
base         = f"ai_call_{detail_id}"

# ── Debug log to file ─────────────────────────────────────────
LOG_FILE = f"/tmp/ai_conv_{detail_id}.log"

def dlog(msg: str):
    ts = time.strftime("%H:%M:%S")
    line = f"[{ts}] {msg}\n"
    try:
        with open(LOG_FILE, "a") as f:
            f.write(line)
    except Exception:
        pass
    # Also write to stderr (shows in Asterisk full log)
    sys.stderr.write(line)
    sys.stderr.flush()

dlog(f"=== START detail_id={detail_id} api={api_base_url} ===")

# ── AGI protocol ──────────────────────────────────────────────
def agi_cmd(cmd: str) -> str:
    sys.stdout.write(cmd + "\n")
    sys.stdout.flush()
    resp = sys.stdin.readline().strip()
    dlog(f"CMD: {cmd!r}  ->  {resp!r}")
    return resp

def stream_file(filename: str) -> str:
    result = agi_cmd(f'STREAM FILE {filename} ""')
    try:
        code = int(result.split("result=")[1].split()[0])
        return chr(code) if code > 0 else ""
    except Exception:
        return ""

def record_file(filename: str, max_silence_sec: int = 3, max_duration_sec: int = 15) -> bool:
    """Record caller speech. Returns True if recording succeeded."""
    result = agi_cmd(
        f"RECORD FILE {filename} wav '#' {max_duration_sec * 1000} s={max_silence_sec}"
    )
    ok = "result=0" in result or "result=1" in result
    dlog(f"RECORD FILE ok={ok} result={result!r}")
    return ok

def post_audio_turn(wav_path: str, turn: int, language: str) -> dict:
    """POST the recorded WAV to the API server for STT → LLM → TTS processing."""
    try:
        with open(wav_path, "rb") as f:
            audio_bytes = f.read()
        dlog(f"POST turn={turn} wav={wav_path} bytes={len(audio_bytes)}")

        boundary = b"----AiBoundary7x"
        body = b""
        # audio field
        body += b"--" + boundary + b"\r\n"
        body += b'Content-Disposition: form-data; name="audio"; filename="speech.wav"\r\n'
        body += b"Content-Type: audio/wav\r\n\r\n"
        body += audio_bytes + b"\r\n"
        # detail_id field
        body += b"--" + boundary + b"\r\n"
        body += b'Content-Disposition: form-data; name="detail_id"\r\n\r\n'
        body += str(detail_id).encode() + b"\r\n"
        # turn field
        body += b"--" + boundary + b"\r\n"
        body += b'Content-Disposition: form-data; name="turn"\r\n\r\n'
        body += str(turn).encode() + b"\r\n"
        # language field
        body += b"--" + boundary + b"\r\n"
        body += b'Content-Disposition: form-data; name="language"\r\n\r\n'
        body += language.encode() + b"\r\n"
        body += b"--" + boundary + b"--\r\n"

        url = f"{api_base_url}/phone-ivr/ai/conversation/turn"
        dlog(f"HTTP POST {url}")
        req = urllib.request.Request(
            url,
            data=body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary.decode()[2:]}"},
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
            result = json.loads(raw)
            dlog(f"API resp: {raw[:200]!r}")
            return result
    except Exception as e:
        dlog(f"POST ERROR: {e}")
        return {}

def post_result(data: dict):
    try:
        url = f"{api_base_url}/phone-ivr/ai/calls/{detail_id}/result"
        payload = json.dumps(data).encode()
        req = urllib.request.Request(
            url, data=payload,
            headers={"Content-Type": "application/json"},
            method="PATCH",
        )
        urllib.request.urlopen(req, timeout=5)
        dlog(f"POST result ok: {data}")
    except Exception as e:
        dlog(f"POST result error: {e}")

# ── Read AGI environment ──────────────────────────────────────
env = {}
while True:
    line = sys.stdin.readline().strip()
    if not line:
        break
    if ": " in line:
        k, v = line.split(": ", 1)
        env[k] = v
dlog(f"AGI env keys: {list(env.keys())}")

# ── Load config ───────────────────────────────────────────────
config = {}
try:
    with open(config_path) as f:
        config = json.load(f)
    dlog(f"Config loaded: {json.dumps(config)[:200]}")
except Exception as e:
    dlog(f"Config load error ({config_path}): {e}")

max_turns = config.get("max_turns", 3)
language  = config.get("language",  "hindi")
dlog(f"max_turns={max_turns} language={language}")

# ── 1. Answer the channel ─────────────────────────────────────
agi_cmd("ANSWER")

# ── 2. Play greeting ──────────────────────────────────────────
dlog(f"Playing greeting: {base}")
stream_file(base)
dlog("Greeting done")

# ── 3. Conversation loop ──────────────────────────────────────
transcript_log = []

for turn in range(1, max_turns + 1):
    rec_path = f"/tmp/ai_conv_{detail_id}_turn_{turn}"
    dlog(f"=== Turn {turn} — recording to {rec_path} ===")

    ok = record_file(rec_path, max_silence_sec=3, max_duration_sec=15)
    if not ok:
        dlog(f"Turn {turn}: record_file failed — ending")
        break

    wav_path = f"{rec_path}.wav"
    if not os.path.exists(wav_path):
        dlog(f"Turn {turn}: wav not found at {wav_path} — ending")
        break

    size = os.path.getsize(wav_path)
    dlog(f"Turn {turn}: wav exists size={size}")
    if size < 500:
        dlog(f"Turn {turn}: wav too small ({size} bytes) — likely silence, ending")
        try:
            os.remove(wav_path)
        except Exception:
            pass
        break

    # Send to API for processing
    response = post_audio_turn(wav_path, turn, language)

    # Cleanup recording
    try:
        os.remove(wav_path)
    except Exception:
        pass

    if not response:
        dlog(f"Turn {turn}: empty API response — ending")
        break

    transcript    = response.get("transcript",    "")
    response_text = response.get("response_text", "")
    audio_file    = response.get("audio_file",    "")
    is_final      = response.get("is_final",      False)

    dlog(f"Turn {turn}: transcript={transcript!r} response={response_text!r} audio={audio_file!r} final={is_final}")

    transcript_log.append({
        "turn":   turn,
        "caller": transcript,
        "ai":     response_text,
    })

    # Play AI response (API already SCP'd the WAV to FreePBX sounds dir)
    if audio_file:
        dlog(f"Turn {turn}: playing {audio_file}")
        stream_file(audio_file)
    else:
        dlog(f"Turn {turn}: no audio_file in response")

    if is_final:
        dlog(f"Turn {turn}: is_final=True — ending conversation")
        break

dlog("Conversation loop ended")

# ── 4. POST final result ──────────────────────────────────────
notes = json.dumps(transcript_log)[:1000] if transcript_log else "AI conversation completed (no turns recorded)."
post_result({"status": "answered", "notes": notes})

# ── 5. Hangup ─────────────────────────────────────────────────
dlog("Hanging up")
agi_cmd("HANGUP")
dlog("=== DONE ===")
