#!/usr/bin/env node
/**
 * AI Call FastAGI Server
 * Deploy this file to your FreePBX server and run it with PM2.
 *
 * SETUP (on FreePBX):
 *   1. mkdir /root/ai-call-agi && cd /root/ai-call-agi
 *   2. Copy this file + package.json here
 *   3. npm install
 *   4. cp .env.example .env  →  fill in your keys
 *   5. pm2 start ai-call-agi.js --name ai-agi
 *   6. pm2 save
 *
 * FreePBX DIALPLAN (Admin → Config Edit → extensions_custom.conf):
 *   [ai-outbound]
 *   exten => s,1,AGI(agi://127.0.0.1:4573/ai-call)
 *   same  => n,Hangup()
 *
 * Then reload Asterisk: asterisk -rx "dialplan reload"
 *
 * HOW IT WORKS:
 *   API server originates call → Asterisk dials → dialplan runs AGI
 *   AGI reads channel variables (greeting, language, etc.)
 *   Generates greeting TTS while call still rings (no silence after answer!)
 *   Answers → plays greeting → records caller → STT → Gemini → TTS → plays response → loop
 *   When done → HTTP PATCH to API server to record result in DB
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const net  = require('net');
const fs   = require('fs');
const path = require('path');
const { GoogleAuth } = require('google-auth-library');

// ── Config ───────────────────────────────────────────────────────
const PORT         = Number(process.env.AGI_PORT     ?? 4573);
const SOUNDS_DIR   = process.env.SOUNDS_DIR          ?? '/var/lib/asterisk/sounds';
const GEMINI_KEY   = process.env.GEMINI_API_KEY      ?? '';
const GEMINI_MODEL = process.env.GEMINI_MODEL        ?? 'gemini-2.5-flash-lite';

// ── Language / Voice maps ────────────────────────────────────────
const LANG_CODE = {
  hindi: 'hi-IN', hinglish: 'hi-IN', english: 'en-IN',
  marathi: 'mr-IN', gujarati: 'gu-IN', tamil: 'ta-IN', telugu: 'te-IN',
};
const VOICE_MAP = {
  'hi-IN': { female: 'hi-IN-Chirp3-HD-Autonoe', male: 'hi-IN-Chirp3-HD-Iapetus' },
  'en-IN': { female: 'en-IN-Wavenet-A',          male: 'en-IN-Wavenet-B' },
  'mr-IN': { female: 'mr-IN-Wavenet-A',          male: 'mr-IN-Wavenet-B' },
  'gu-IN': { female: 'gu-IN-Wavenet-A',          male: 'gu-IN-Wavenet-B' },
  'ta-IN': { female: 'ta-IN-Wavenet-A',          male: 'ta-IN-Wavenet-B' },
  'te-IN': { female: 'te-IN-Wavenet-A',          male: 'te-IN-Wavenet-B' },
};

// ── Google Auth (cached, refreshes before expiry) ────────────────
const googleAuth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
let _token = null, _tokenExp = 0;
async function getGoogleToken() {
  if (Date.now() < _tokenExp && _token) return _token;
  const client = await googleAuth.getClient();
  const { token } = await client.getAccessToken();
  _token    = token;
  _tokenExp = Date.now() + 55 * 60 * 1000; // refresh 5 min before expiry
  return _token;
}

// ── Google TTS ───────────────────────────────────────────────────
async function tts(text, language, gender, outPath, voiceNameOverride, langCodeOverride, ssmlGenderOverride) {
  const langCode  = langCodeOverride || LANG_CODE[language] || 'hi-IN';
  const voices    = VOICE_MAP[langCode] ?? VOICE_MAP['hi-IN'];
  const voiceName = voiceNameOverride || voices[gender] || voices.female;
  const ssmlGender = ssmlGenderOverride || (gender === 'male' ? 'MALE' : 'FEMALE');
  const token     = await getGoogleToken();

  const res = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      input:       { text },
      voice:       { languageCode: langCode, name: voiceName, ssmlGender },
      audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 8000 },
    }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text()}`);
  const { audioContent } = await res.json();
  fs.writeFileSync(outPath, Buffer.from(audioContent, 'base64'));
}

// ── Google STT ───────────────────────────────────────────────────
async function stt(filePath, language) {
  const langCode = LANG_CODE[language] ?? 'hi-IN';
  const token    = await getGoogleToken();
  const audio    = fs.readFileSync(filePath);

  const res = await fetch('https://speech.googleapis.com/v1/speech:recognize', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      config: {
        encoding: 'MULAW',
        sampleRateHertz: 8000,
        languageCode: langCode,
        model: 'latest_short',
      },
      audio:  { content: audio.toString('base64') },
    }),
  });
  if (!res.ok) throw new Error(`STT ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.results?.[0]?.alternatives?.[0]?.transcript?.trim() ?? '';
}

// ── Gemini (streaming SSE) ───────────────────────────────────────
async function gemini(sysPrompt, history) {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY not set');
  const contents = history.map(m => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?key=${GEMINI_KEY}&alt=sse`;
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: sysPrompt }] },
      contents,
      generationConfig: { maxOutputTokens: 80, temperature: 0.7 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);

  let text = '';
  const reader = res.body.getReader();
  const dec    = new TextDecoder();
  let   buf    = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const s = line.slice(6).trim();
      if (!s || s === '[DONE]') continue;
      try { text += JSON.parse(s).candidates?.[0]?.content?.parts?.[0]?.text ?? ''; } catch {}
    }
  }
  return text.trim();
}

// ── FastAGI Session ──────────────────────────────────────────────
class AGI {
  constructor(sock) {
    this.sock   = sock;
    this.env    = {};
    this.closed = false;
    this._lines = [];
    this._wait  = [];

    let buf = '';
    sock.on('data', data => {
      buf += data.toString();
      let i;
      while ((i = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (this._wait.length) this._wait.shift()(line);
        else this._lines.push(line);
      }
    });
    const end = () => {
      this.closed = true;
      this._wait.forEach(r => r(null));
      this._wait = [];
    };
    sock.on('close', end);
    sock.on('error', end);
  }

  _rl() {
    return new Promise(resolve => {
      if (this._lines.length) return resolve(this._lines.shift());
      if (this.closed)        return resolve(null);
      this._wait.push(resolve);
    });
  }

  // Read the initial agi_xxx headers Asterisk sends on connect
  async readEnv() {
    for (;;) {
      const line = await this._rl();
      if (!line) break; // empty line = end of headers
      const sep = line.indexOf(': ');
      if (sep !== -1) this.env[line.slice(0, sep)] = line.slice(sep + 2);
    }
  }

  // Send an AGI command and return the response line
  async cmd(command) {
    if (this.closed) throw new Error('hangup');
    this.sock.write(command + '\n');
    const resp = await this._rl();
    if (resp === null)           throw new Error('hangup');
    if (resp.includes('result=-1') || resp.startsWith('511')) throw new Error('hangup');
    return resp;
  }

  async getVar(name) {
    try {
      const resp = await this.cmd(`GET VARIABLE ${name}`);
      const m    = resp.match(/result=1 \((.+?)\)/);
      return m ? m[1] : '';
    } catch { return ''; }
  }

  // Play a sound file (name without extension, relative to SOUNDS_DIR)
  async play(name) {
    await this.cmd(`STREAM FILE ${name} ""`);
  }

  // Record caller audio — saves as /tmp/<filename>.ulaw
  // Stops after <silenceSec> seconds of silence or <maxSec> seconds total
  async record(filename, silenceSec = 1.5, maxSec = 10) {
    await this.cmd(`RECORD FILE ${filename} ulaw "#" ${maxSec * 1000} 0 s=${silenceSec}`);
  }

  async answer() { await this.cmd('ANSWER'); }

  async hangup() {
    try { await this.cmd('HANGUP'); } catch {}
    this.sock.destroy();
  }
}

// ── Handle one call ──────────────────────────────────────────────
async function handleCall(sock) {
  const agi  = new AGI(sock);
  const t0   = Date.now();
  let detailId      = '?';
  let callbackUrl   = '';
  let turns         = 0;
  let finalStatus   = 'not_answered';
  let recordingPath = '';
  let history       = [];

  try {
    await agi.readEnv();

    // Read channel variables set by the API server when originating the call
    detailId       = await agi.getVar('AI_DETAIL_ID');
    const greeting    = await agi.getVar('AI_GREETING')      || 'Namaste! Kya aap ek minute baat kar sakte hain?';
    const sysRaw      = await agi.getVar('AI_SYSTEM_PROMPT') || 'You are a helpful AI sales assistant on a phone call. Respond in Hindi. Keep replies SHORT — 1 to 2 sentences. Be friendly and natural.';
    const language    = await agi.getVar('AI_LANGUAGE')      || 'hindi';
    const gender      = await agi.getVar('AI_GENDER')        || 'female';
    const maxTurns    = Number(await agi.getVar('AI_MAX_TURNS') || '10');
    callbackUrl          = await agi.getVar('AI_CALLBACK_URL')    || process.env.AI_CALLBACK_URL || '';
    const voiceName      = await agi.getVar('AI_VOICE_NAME')      || '';
    const langCode       = await agi.getVar('AI_LANGUAGE_CODE')   || '';
    const ssmlGender     = await agi.getVar('AI_SSML_GENDER')     || '';
    recordingPath        = await agi.getVar('AI_RECORDING_PATH')  || '';

    const sysPrompt = sysRaw + ' IMPORTANT: Reply in 1-2 sentences only. Do not use bullet points or lists.';

    console.log(`[AGI] ${detailId} start lang=${language} gender=${gender} voice=${voiceName||'default'} maxTurns=${maxTurns}`);

    const greetBase  = `ai_greet_${detailId}`;
    const fillerText = language === 'english' ? 'Yes, just a moment please.' : 'हाँ, एक पल रुकिए।';
    const fillerBase = `ai_filler_${detailId}`;

    // ── Generate greeting + filler TTS BEFORE answering ──────────
    // Call still rings while we generate audio — no silence after answer!
    await Promise.all([
      tts(greeting,   language, gender, path.join(SOUNDS_DIR, `${greetBase}.wav`),  voiceName, langCode, ssmlGender),
      tts(fillerText, language, gender, path.join(SOUNDS_DIR, `${fillerBase}.wav`), voiceName, langCode, ssmlGender),
    ]);

    // ── Answer and immediately play greeting ─────────────────────
    await agi.answer();
    await agi.play(greetBase);

    // ── AI conversation loop ─────────────────────────────────────
    let turn = 0;

    const REC_DIR   = '/var/spool/asterisk/tmp';
    let   silentRetries = 0;
    const MAX_SILENT    = 5;

    while (turn < maxTurns) {
      turn++;
      const recPath = `${REC_DIR}/ai_rec_${detailId}_t${turn}`;

      // Record caller (3s silence detection, 15s max)
      const recResp = await agi.cmd(`RECORD FILE ${recPath} ulaw "#" ${15 * 1000} 0 s=3`);
      console.log(`[AGI] ${detailId} t${turn} record-resp="${recResp}"`);

      const recFile = `${recPath}.ulaw`;
      let   fileSize = 0;
      try { fileSize = fs.statSync(recFile).size; } catch {}

      if (fileSize < 4000) {  // < ~0.5s of audio = skip
        silentRetries++;
        console.log(`[AGI] ${detailId} t${turn} silent (${fileSize}B), retry ${silentRetries}/${MAX_SILENT}`);
        try { fs.unlinkSync(recFile); } catch {}
        if (silentRetries >= MAX_SILENT) {
          console.log(`[AGI] ${detailId} max silent retries reached, ending call`);
          break;
        }
        turn--;
        continue;
      }

      // ── STT: user hears nothing here (~2-3s) ─────────────────
      const transcript = await stt(recFile, language)
        .finally(() => { try { fs.unlinkSync(recFile); } catch {} });

      console.log(`[AGI] ${detailId} t${turn} stt="${transcript}"`);

      if (!transcript.trim()) {
        silentRetries++;
        console.log(`[AGI] ${detailId} t${turn} no speech, retry ${silentRetries}/${MAX_SILENT}`);
        if (silentRetries >= MAX_SILENT) {
          console.log(`[AGI] ${detailId} max no-speech retries reached, ending call`);
          break;
        }
        turn--;
        continue;
      }
      silentRetries = 0;

      history.push({ role: 'user', content: transcript });
      turns++;

      const isFinal = turn >= maxTurns
        || /bye|goodbye|shukriya|alvida|theek hai|ok bye/i.test(transcript);

      // ── LLM + TTS in background, filler plays concurrently ───
      // Node.js event loop runs both the fetch (LLM) and AGI socket (filler) at the same time
      const aiWorkPromise = (async () => {
        const reply    = await gemini(sysPrompt, history);
        const respBase = `ai_resp_${detailId}_t${turn}`;
        const respPath = path.join(SOUNDS_DIR, `${respBase}.wav`);
        await tts(reply, language, gender, respPath, voiceName, langCode, ssmlGender);
        history.push({ role: 'assistant', content: reply });
        console.log(`[AGI] ${detailId} t${turn} ai="${reply}"`);
        return { respBase, respPath };
      })();
      aiWorkPromise.catch(() => {}); // prevent unhandledRejection if filler throws first

      // Play filler while LLM+TTS runs (concurrent via Node.js event loop)
      await agi.play(fillerBase);

      // Wait for LLM+TTS to finish (ideally already done by the time filler ends)
      const { respBase, respPath } = await aiWorkPromise;

      // Play AI response, then short pause so echo dies down before recording
      await agi.play(respBase);
      try { fs.unlinkSync(respPath); } catch {}
      await new Promise(r => setTimeout(r, 400));

      if (isFinal) break;
    }

    finalStatus = 'answered';
    console.log(`[AGI] ${detailId} done turns=${turns} duration=${Math.round((Date.now() - t0) / 1000)}s`);

  } catch (err) {
    if (err.message !== 'hangup') {
      console.error(`[AGI] ${detailId} error:`, err.message);
    }
  } finally {
    const duration = Math.round((Date.now() - t0) / 1000);

    // Clean up sound files
    try { fs.unlinkSync(path.join(SOUNDS_DIR, `ai_greet_${detailId}.wav`));  } catch {}
    try { fs.unlinkSync(path.join(SOUNDS_DIR, `ai_filler_${detailId}.wav`)); } catch {}

    await agi.hangup();

    if (callbackUrl && detailId !== '?') {
      // ── Upload recording (both sides, mixed by MixMonitor) ───────
      let recordingUrl = '';
      if (recordingPath) {
        // Wait up to 3s for Asterisk to finish writing the file after hangup
        await new Promise(r => setTimeout(r, 3000));
        try {
          const recBuf = fs.readFileSync(recordingPath);
          const form   = new FormData();
          form.append('recording', new Blob([recBuf], { type: 'audio/wav' }), `call_${detailId}.wav`);
          form.append('detail_id', String(detailId));
          const upRes = await fetch(`${callbackUrl}/${detailId}/recording`, {
            method: 'POST',
            body:   form,
          });
          if (upRes.ok) {
            const upJson = await upRes.json();
            recordingUrl = upJson.url ?? '';
            console.log(`[AGI] ${detailId} recording uploaded: ${recordingUrl}`);
          } else {
            console.error(`[AGI] ${detailId} recording upload failed: ${upRes.status}`);
          }
          try { fs.unlinkSync(recordingPath); } catch {}
        } catch (e) {
          console.error(`[AGI] ${detailId} recording upload error:`, e.message);
        }
      }

      // ── PATCH result + full conversation transcript ───────────────
      fetch(`${callbackUrl}/${detailId}/result`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status:        finalStatus,
          call_duration: duration,
          notes:         `AI conversation: ${turns} turn(s)`,
          recording_url: recordingUrl || undefined,
          conversation:  history,
        }),
      }).catch(e => console.error(`[AGI] ${detailId} callback failed:`, e.message));
    }
  }
}

// ── Start FastAGI server ─────────────────────────────────────────
const server = net.createServer(sock => {
  sock.on('error', () => {});
  handleCall(sock).catch(err => console.error('[AGI server] unhandled:', err.message));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[AGI] FastAGI server listening on port ${PORT}`);
  console.log(`[AGI] Sounds dir: ${SOUNDS_DIR}`);
  console.log(`[AGI] Gemini model: ${GEMINI_MODEL}`);
});

process.on('uncaughtException',  err => console.error('[AGI] uncaught:', err.message));
process.on('unhandledRejection', err => console.error('[AGI] unhandled rejection:', err));
