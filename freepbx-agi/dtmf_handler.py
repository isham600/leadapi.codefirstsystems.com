#!/usr/bin/env python3
"""
FreePBX AGI Script: DTMF Interaction Handler
Deploy to: /var/lib/asterisk/agi-bin/dtmf_handler.py
chmod +x /var/lib/asterisk/agi-bin/dtmf_handler.py
chown asterisk:asterisk /var/lib/asterisk/agi-bin/dtmf_handler.py

Called by AMI Originate:
  Application: AGI
  Data: dtmf_handler.py,{detail_id},{api_base_url}

Flow:
  1. Play greeting audio
  2. Play DTMF prompt ("Press 1 for Interested, Press 2 for Callback...")
  3. Wait for keypress
  4. Play matching response audio
  5. POST result to API callback
"""

import sys
import os
import json
import urllib.request

# ── Args ──────────────────────────────────────────────────────
detail_id    = sys.argv[1] if len(sys.argv) > 1 else "0"
api_base_url = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:3003"

config_path  = f"/tmp/ai_call_{detail_id}_config.json"
base         = f"ai_call_{detail_id}"

# ── AGI protocol ──────────────────────────────────────────────
def agi_cmd(cmd: str) -> str:
    sys.stdout.write(cmd + "\n")
    sys.stdout.flush()
    return sys.stdin.readline().strip()

def stream_file(filename: str, escape_digits: str = "") -> str:
    """Play a sound file. Returns the digit pressed (if any)."""
    result = agi_cmd(f'STREAM FILE {filename} "{escape_digits}"')
    # result = "200 result=49" (49 = ASCII '1')
    try:
        code = int(result.split("result=")[1].split()[0])
        return chr(code) if code > 0 else ""
    except Exception:
        return ""

def wait_for_digit(timeout_ms: int = 7000) -> str:
    """Wait up to timeout_ms for a DTMF digit."""
    result = agi_cmd(f"WAIT FOR DIGIT {timeout_ms}")
    try:
        code = int(result.split("result=")[1].split()[0])
        return chr(code) if code > 0 else ""
    except Exception:
        return ""

def post_result(data: dict):
    try:
        payload = json.dumps(data).encode()
        req = urllib.request.Request(
            f"{api_base_url}/phone-ivr/ai/calls/{detail_id}/result",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="PATCH",
        )
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass  # never crash the call on webhook failure

# ── Read AGI environment (consume all lines until blank) ──────
while True:
    line = sys.stdin.readline().strip()
    if not line:
        break

# ── Load config ───────────────────────────────────────────────
config       = {}
dtmf_options = []
try:
    with open(config_path) as f:
        config = json.load(f)
    dtmf_options = config.get("dtmf_options", [])
except Exception:
    pass

# ── Build valid digit set ─────────────────────────────────────
valid_keys = "".join(o.get("key", "") for o in dtmf_options)

# ── 1. Play greeting (interrupt allowed with any digit) ───────
digit = stream_file(base, valid_keys + "#*")

# ── 2. If no digit during greeting, play DTMF prompt ─────────
if not digit and dtmf_options:
    digit = stream_file(f"{base}_prompt", valid_keys + "#*")

# ── 3. If still no digit, wait ────────────────────────────────
if not digit and dtmf_options:
    digit = wait_for_digit(7000)
    # Replay prompt once if still no digit
    if not digit:
        stream_file(f"{base}_prompt", valid_keys + "#*")
        digit = wait_for_digit(5000)

# ── 4. Match digit to option ──────────────────────────────────
matched = next((o for o in dtmf_options if o.get("key") == digit), None)
outcome = matched.get("outcome", "no_response") if matched else "no_response"
label   = matched.get("label",   "No response")  if matched else "No response"

# ── 5. Play response audio ────────────────────────────────────
if matched:
    stream_file(f"{base}_resp_{digit}")

# ── 6. POST result ────────────────────────────────────────────
post_result({
    "status": "answered",
    "notes":  f"DTMF:{digit} | {label} | outcome:{outcome}",
})

# ── 7. Hangup ─────────────────────────────────────────────────
agi_cmd("HANGUP")
