/**
 * Phone AI Campaign Worker — ARI-based (no SSH / SCP / AGI scripts)
 *
 * Architecture:
 *   API server ──ARI HTTP──► FreePBX (dials via SIP trunk)
 *   API server ◄──WS events── FreePBX
 *   API server ──HTTP URL──► FreePBX (fetches TTS audio)
 *   API server ◄──ARI HTTP── FreePBX (recording download)
 *
 * All audio I/O is handled here:
 *   Google TTS  → /tmp WAV → served via HTTP → Asterisk plays
 *   Asterisk records caller → ARI HTTP download → Google STT → GPT-4o → repeat
 *
 * FreePBX setup required (once):
 *   1. Enable ARI in /etc/asterisk/ari.conf (see AI_CALLING_SETUP.md)
 *   2. Open port 8088 (or restrict to API server IP)
 *   3. API server must be reachable from FreePBX on API_BASE_URL
 */

import { Worker, Job } from "bullmq";
import { sql }         from "kysely";
import { writeFile, unlink } from "fs/promises";
import { GoogleAuth }  from "google-auth-library";
import WebSocket       from "ws";
import { exec }        from "child_process";
import { promisify }   from "util";
const execAsync = promisify(exec);

import { db }                   from "../models/db.js";
import { redisConnection }       from "../queues/campaign.queue.js";
import type { PhoneAiCampaignJobData } from "../queues/phone-ai-campaign.queue.js";
import { aiCallLog }            from "../utils/phone-ai-logger.js";

// ── Batch / timing ────────────────────────────────────────────
const BATCH_SIZE      = 5;
const POLL_DELAY_MS   = 2_000;
const CALL_TIMEOUT_MS = 300_000; // 5 min — generous for multi-turn AI conversation

// ── FreePBX ARI config ────────────────────────────────────────
// ARI runs on FreePBX port 8088 (HTTP) / 8089 (HTTPS)
const ARI_HOST   = process.env.ASTERISK_ARI_HOST   ?? process.env.ASTERISK_AMI_HOST ?? "127.0.0.1";
const ARI_PORT   = process.env.ASTERISK_ARI_PORT   ?? "8088";
const ARI_USER   = process.env.ASTERISK_ARI_USER   ?? process.env.ASTERISK_AMI_USER ?? "admin";
const ARI_SECRET = process.env.ASTERISK_ARI_SECRET ?? process.env.ASTERISK_AMI_SECRET ?? "";
const ARI_APP    = process.env.ASTERISK_ARI_APP    ?? "ai-caller";

// Outbound channel: PJSIP/{number}@trunk  or  SIP/trunk/{number}
const CHANNEL_FMT  = process.env.ASTERISK_CHANNEL_FMT ?? "PJSIP/{number}@from-internal";
const CALLER_ID    = process.env.ASTERISK_CALLER_ID   ?? "";

// SSH/SCP for copying WAV files to FreePBX sounds directory
const FREEPBX_HOST     = process.env.FREEPBX_SSH_HOST  ?? "";
const FREEPBX_SSH_KEY  = process.env.FREEPBX_SSH_KEY   ?? "/root/.ssh/freepbx_tts";
const FREEPBX_SSH_USER = process.env.FREEPBX_SSH_USER  ?? "root";
const FREEPBX_SSH_PORT = process.env.FREEPBX_SSH_PORT  ?? "22";
const SOUNDS_PATH      = process.env.ASTERISK_SOUNDS_PATH ?? "/var/lib/asterisk/sounds";

// ── DB helpers ────────────────────────────────────────────────

async function claimBatch(requestId: string): Promise<any[]> {
  await (db as any).executeQuery(
    sql`UPDATE phone_ivr_camp_details
        SET    status = 'calling', called_at = NOW(), updated_at = NOW()
        WHERE  request_id = ${requestId} AND status = 'pp1'
        LIMIT  ${BATCH_SIZE}`.compile(db as any)
  );
  return (db as any)
    .selectFrom("phone_ivr_camp_details")
    .select(["id", "phone_number", "lead_name", "lead_id", "retry_count"])
    .where("request_id", "=", requestId)
    .where("status",     "=", "calling")
    .limit(BATCH_SIZE)
    .execute();
}

async function markResult(
  id: number,
  status: "answered" | "not_answered" | "failed" | "completed",
  extra: { call_duration?: number; call_sid?: string; notes?: string } = {}
) {
  await (db as any)
    .updateTable("phone_ivr_camp_details")
    .set({ status, call_duration: extra.call_duration ?? null, call_sid: extra.call_sid ?? null,
           notes: extra.notes ?? null, completed_at: new Date(), updated_at: new Date() })
    .where("id", "=", id)
    .execute();
}

async function refreshSummary(requestId: string) {
  const counts: any = await (db as any)
    .selectFrom("phone_ivr_camp_details")
    .select([
      (db as any).fn.count("id").as("total"),
      sql<number>`SUM(CASE WHEN status='pp1'          THEN 1 ELSE 0 END)`.as("pending"),
      sql<number>`SUM(CASE WHEN status='calling'      THEN 1 ELSE 0 END)`.as("calling"),
      sql<number>`SUM(CASE WHEN status='answered'     THEN 1 ELSE 0 END)`.as("answered"),
      sql<number>`SUM(CASE WHEN status='not_answered' THEN 1 ELSE 0 END)`.as("not_answered"),
      sql<number>`SUM(CASE WHEN status='failed'       THEN 1 ELSE 0 END)`.as("failed"),
      sql<number>`SUM(CASE WHEN status='completed'    THEN 1 ELSE 0 END)`.as("completed"),
    ])
    .where("request_id", "=", requestId)
    .executeTakeFirst();

  const allDone = Number(counts?.pending ?? 0) === 0 && Number(counts?.calling ?? 0) === 0;
  const set: any = {
    pending: Number(counts?.pending ?? 0), calling: Number(counts?.calling ?? 0),
    answered: Number(counts?.answered ?? 0), not_answered: Number(counts?.not_answered ?? 0),
    failed: Number(counts?.failed ?? 0), completed: Number(counts?.completed ?? 0),
    updated_at: new Date(),
  };
  if (allDone) set.status = "completed";
  await (db as any).updateTable("phone_ivr_camp_summury").set(set).where("request_id", "=", requestId).execute();
  return { allDone };
}

// ── Google auth (shared, reuses tokens) ───────────────────────
const googleAuth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });

const LANG_CODE: Record<string, string> = {
  hindi: "hi-IN", english: "en-IN", hinglish: "hi-IN",
  marathi: "mr-IN", gujarati: "gu-IN", tamil: "ta-IN", telugu: "te-IN",
};
const VOICE_NAME: Record<string, { male: string; female: string }> = {
  "hi-IN": { female: "hi-IN-Chirp3-HD-Autonoe", male: "hi-IN-Chirp3-HD-Iapetus" },
  "en-IN": { female: "en-IN-Wavenet-A", male: "en-IN-Wavenet-B" },
  "mr-IN": { female: "mr-IN-Wavenet-A", male: "mr-IN-Wavenet-B" },
  "gu-IN": { female: "gu-IN-Wavenet-A", male: "gu-IN-Wavenet-B" },
  "ta-IN": { female: "ta-IN-Wavenet-A", male: "ta-IN-Wavenet-B" },
  "te-IN": { female: "te-IN-Wavenet-A", male: "te-IN-Wavenet-B" },
};

// ── Google TTS ────────────────────────────────────────────────
async function synthesizeSpeech(text: string, language: string, gender: "male" | "female", outPath: string) {
  const langCode  = LANG_CODE[language] ?? "hi-IN";
  const voiceName = VOICE_NAME[langCode]?.[gender] ?? "hi-IN-Wavenet-A";
  const client    = await googleAuth.getClient();
  const td        = await client.getAccessToken();
  const token     = typeof td === "string" ? td : td?.token;
  if (!token) throw new Error("Google auth token failed");

  const res = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: langCode, name: voiceName, ssmlGender: gender === "male" ? "MALE" : "FEMALE" },
      audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: 8000 },
    }),
  });
  if (!res.ok) throw new Error(`Google TTS ${res.status}: ${await res.text()}`);
  const json: any = await res.json();
  await writeFile(outPath, Buffer.from(json.audioContent, "base64"));
}

// ── ARI helpers ───────────────────────────────────────────────

const ARI_AUTH = () => `Basic ${Buffer.from(`${ARI_USER}:${ARI_SECRET}`).toString("base64")}`;

async function ariHttp(method: string, path: string, body?: Record<string, any>): Promise<any> {
  const res = await fetch(`http://${ARI_HOST}:${ARI_PORT}/ari${path}`, {
    method,
    headers: { Authorization: ARI_AUTH(), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`ARI ${method} ${path}: ${res.status} ${await res.text()}`);
  const ct = res.headers.get("content-type") ?? "";
  return ct.includes("json") ? res.json() : Buffer.from(await res.arrayBuffer());
}

function ariWsUrl() {
  return `ws://${ARI_HOST}:${ARI_PORT}/ari/events?app=${ARI_APP}&api_key=${encodeURIComponent(`${ARI_USER}:${ARI_SECRET}`)}`;
}

function buildEndpoint(phoneNumber: string) {
  return CHANNEL_FMT.replace("{number}", phoneNumber);
}

// ── SSH ControlMaster (reuse one TCP connection, removes per-SCP handshake ~2-4s) ──
let _sshCtlPath: string | null = null;
let _sshCtlInit: Promise<string> | null = null;

async function ensureSshControl(): Promise<string> {
  if (!FREEPBX_HOST) return "";
  if (_sshCtlPath !== null) return _sshCtlPath;
  if (_sshCtlInit) return _sshCtlInit;
  _sshCtlInit = (async () => {
    const ctl = `/tmp/freepbx_ctl_${process.pid}`;
    try {
      // Check if a master socket already exists from a previous crash/restart
      await execAsync(`ssh -o ControlPath=${ctl} -O check ${FREEPBX_SSH_USER}@${FREEPBX_HOST} 2>/dev/null`);
    } catch {
      await execAsync(
        `ssh -i ${FREEPBX_SSH_KEY} -p ${FREEPBX_SSH_PORT} -o StrictHostKeyChecking=no ` +
        `-o ControlMaster=yes -o ControlPath=${ctl} -o ControlPersist=300s -f -N ` +
        `${FREEPBX_SSH_USER}@${FREEPBX_HOST}`
      );
    }
    _sshCtlPath = ctl;
    console.log("[SSH] ControlMaster ready:", ctl);
    return ctl;
  })();
  return _sshCtlInit;
}

// SCP wav from /tmp on API server → FreePBX sounds directory
async function scpToFreePBX(localPath: string, remoteName: string) {
  if (!FREEPBX_HOST) throw new Error("FREEPBX_SSH_HOST not set");
  const ctl    = await ensureSshControl();
  const ctlOpt = ctl ? `-o ControlPath=${ctl} -o ControlMaster=no` : "";
  const dest   = `${FREEPBX_SSH_USER}@${FREEPBX_HOST}:${SOUNDS_PATH}/${remoteName}`;
  await execAsync(`scp -i ${FREEPBX_SSH_KEY} -P ${FREEPBX_SSH_PORT} -o StrictHostKeyChecking=no ${ctlOpt} ${localPath} ${dest}`);
  console.log(`[scp] ${remoteName} → ${SOUNDS_PATH}/`);
}

function sshRm(...remoteNames: string[]) {
  if (!FREEPBX_HOST) return;
  const ctl    = _sshCtlPath ?? "";
  const ctlOpt = ctl ? `-o ControlPath=${ctl} -o ControlMaster=no` : "";
  const files  = remoteNames.map(n => `${SOUNDS_PATH}/${n}`).join(" ");
  execAsync(`ssh -i ${FREEPBX_SSH_KEY} -p ${FREEPBX_SSH_PORT} -o StrictHostKeyChecking=no ${ctlOpt} ${FREEPBX_SSH_USER}@${FREEPBX_HOST} "rm -f ${files}"`).catch(() => {});
}

// ARI media reference: sound:name plays SOUNDS_PATH/name.wav on FreePBX
function soundRef(nameWithoutExt: string) {
  return `sound:${nameWithoutExt}`;
}

type CallResult = {
  status: "answered" | "not_answered" | "failed";
  call_duration?: number;
  call_sid?: string;
  notes?: string;
};

// ── Shared: open WS, wait for ready, then run callback ───────
// This ensures StasisStart is never missed because WS connects after originate.
function withAriWs(
  onOpen: (ws: WebSocket) => Promise<void>,
  onMessage: (ws: WebSocket, evt: any) => Promise<void>,
  onDone: (ws: WebSocket) => void,
): WebSocket {
  const ws = new WebSocket(ariWsUrl());
  ws.on("open", () => {
    console.log("[ARI WS] open");
    onOpen(ws).catch(err => console.error("[ARI onOpen error]", err?.message ?? err));
  });
  ws.on("message", (raw) => {
    let evt: any;
    try { evt = JSON.parse(raw.toString()); } catch { return; }
    console.log(`[ARI WS event] type=${evt.type} channel=${evt.channel?.id ?? ""} playback=${evt.playback?.id ?? ""} recording=${evt.recording?.name ?? ""}`);
    onMessage(ws, evt).catch(err => console.error(`[ARI onMessage error] evt=${evt.type}`, err?.message ?? err));
  });
  ws.on("close",   ()    => { console.log("[ARI WS] closed"); onDone(ws); });
  ws.on("error",   (err) => { console.error("[ARI WS error]", err?.message ?? err); onDone(ws); });
  return ws;
}

// ── Mode: Voice Blast ─────────────────────────────────────────
async function dialVoiceBlast(detailId: number, phoneNumber: string, template: any): Promise<CallResult> {
  const lang    = template.language     ?? "hindi";
  const gender  = template.voice_gender ?? "female";
  const logCtx  = { phoneNumber, callMode: "voice_blast" };
  const t0      = Date.now();

  const base    = `ai_blast_${detailId}`;
  const wavPath = `/tmp/${base}.wav`;
  const ttsText = template.greeting || template.script || "Namaste, aapko ek important call hai.";

  await synthesizeSpeech(ttsText, lang, gender as any, wavPath);
  await scpToFreePBX(wavPath, `${base}.wav`);
  unlink(wavPath).catch(() => {});
  aiCallLog(detailId, "tts_ok", { text: ttsText, file: base }, logCtx);

  return new Promise<CallResult>((resolve) => {
    let channelId = "";
    let answered  = false;
    let settled   = false;
    const timer   = setTimeout(() => done("not_answered"), CALL_TIMEOUT_MS);

    function done(status: CallResult["status"]) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (channelId) ariHttp("DELETE", `/channels/${channelId}`).catch(() => {});
      sshRm(`${base}.wav`);
      const dur = Math.round((Date.now() - t0) / 1000);
      aiCallLog(detailId, "ami_result", { status, duration_sec: answered ? dur : undefined }, logCtx);
      resolve({ status, call_duration: answered ? dur : undefined, call_sid: channelId,
                notes: answered ? "Voice blast played." : undefined });
    }

    withAriWs(
      async () => {
        const endpoint = buildEndpoint(phoneNumber);
        const ch: any  = await ariHttp("POST", "/channels", {
          endpoint, app: ARI_APP,
          ...(CALLER_ID ? { callerId: CALLER_ID } : {}),
          timeout: 60,
        });
        channelId = ch.id;
        aiCallLog(detailId, "ami_sent", { channelId, endpoint }, logCtx);
      },
      async (_ws, evt) => {
        const mine = evt.channel?.id === channelId;
        if (evt.type === "StasisStart" && mine) {
          answered = true;
          await ariHttp("POST", `/channels/${channelId}/play`, { media: soundRef(base) });
        }
        if (evt.type === "PlaybackFinished" && evt.playback?.target_uri === `channel:${channelId}`) {
          done("answered");
        }
        if (["ChannelHangupRequest","ChannelDestroyed","StasisEnd"].includes(evt.type) && mine) {
          done(answered ? "answered" : "not_answered");
        }
      },
      () => { if (!settled) done(answered ? "answered" : "not_answered"); }
    );
  });
}

// ── Mode: DTMF ────────────────────────────────────────────────
// Dial → play greeting → play prompt → wait for keypress → play response → hang up
function buildDtmfPromptText(options: any[], language: string): string {
  const parts = options.map((o: any) =>
    (language === "hindi" || language === "hinglish")
      ? `${o.label} ke liye ${o.key} dabayein`
      : `Press ${o.key} for ${o.label}`
  );
  return (language === "hindi" || language === "hinglish")
    ? parts.join(", ") + ". Kripya apna jawab chunein."
    : parts.join(", ") + ". Please make your selection.";
}

async function dialDtmf(detailId: number, phoneNumber: string, template: any): Promise<CallResult> {
  const dtmfOptions: any[] = template.dtmf_options
    ? (typeof template.dtmf_options === "string" ? JSON.parse(template.dtmf_options) : template.dtmf_options)
    : [];
  if (!dtmfOptions.length) return dialVoiceBlast(detailId, phoneNumber, template);

  const lang    = template.language     ?? "hindi";
  const gender  = template.voice_gender ?? "female";
  const logCtx  = { phoneNumber, callMode: "dtmf" };
  const t0      = Date.now();
  const base    = `ai_dtmf_${detailId}`;

  const greetingPath = `/tmp/${base}_greeting.wav`;
  const promptPath   = `/tmp/${base}_prompt.wav`;
  const respPaths: Record<string, string> = {};
  const promptText   = buildDtmfPromptText(dtmfOptions, lang);

  await Promise.all([
    synthesizeSpeech(template.greeting || "Namaste!", lang, gender as any, greetingPath),
    synthesizeSpeech(promptText, lang, gender as any, promptPath),
    ...dtmfOptions.map((o: any) => {
      respPaths[o.key] = `/tmp/${base}_resp_${o.key}.wav`;
      return synthesizeSpeech(o.response_text || "Thank you.", lang, gender as any, respPaths[o.key]);
    }),
  ]);
  aiCallLog(detailId, "tts_ok", { greeting: template.greeting, prompt: promptText, keys: dtmfOptions.map((o: any) => o.key) }, logCtx);

  // SCP all audio to FreePBX before originating
  await Promise.all([
    scpToFreePBX(greetingPath, `${base}_greeting.wav`),
    scpToFreePBX(promptPath,   `${base}_prompt.wav`),
    ...dtmfOptions.map((o: any) => scpToFreePBX(respPaths[o.key], `${base}_resp_${o.key}.wav`)),
  ]);
  [greetingPath, promptPath, ...Object.values(respPaths)].forEach(f => unlink(f).catch(() => {}));

  const remoteFiles = [`${base}_greeting.wav`, `${base}_prompt.wav`,
    ...dtmfOptions.map((o: any) => `${base}_resp_${o.key}.wav`)];

  return new Promise<CallResult>((resolve) => {
    let channelId = "";
    let answered  = false;
    let settled   = false;
    let phase: "greeting" | "prompt" | "response" = "greeting";
    let curPbId   = "";
    let dtmfNote  = "";
    const timer   = setTimeout(() => done("not_answered"), CALL_TIMEOUT_MS);

    function done(status: CallResult["status"], notes?: string) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (channelId) ariHttp("DELETE", `/channels/${channelId}`).catch(() => {});
      sshRm(...remoteFiles);
      const dur = Math.round((Date.now() - t0) / 1000);
      aiCallLog(detailId, "ami_result", { status, notes, duration_sec: answered ? dur : undefined }, logCtx);
      resolve({ status, call_duration: answered ? dur : undefined, call_sid: channelId, notes });
    }

    withAriWs(
      async () => {
        const endpoint = buildEndpoint(phoneNumber);
        const ch: any  = await ariHttp("POST", "/channels", {
          endpoint, app: ARI_APP,
          ...(CALLER_ID ? { callerId: CALLER_ID } : {}),
          timeout: 60,
        });
        channelId = ch.id;
        aiCallLog(detailId, "ami_sent", { channelId, endpoint, keys: dtmfOptions.map((o: any) => o.key) }, logCtx);
      },
      async (_ws, evt) => {
        const mine = evt.channel?.id === channelId;
        const myPb = evt.playback?.id === curPbId;

        if (evt.type === "StasisStart" && mine) {
          answered = true;
          phase    = "greeting";
          const pb = await ariHttp("POST", `/channels/${channelId}/play`, { media: soundRef(`${base}_greeting`) });
          curPbId  = pb?.id ?? "";
        }

        if (evt.type === "PlaybackFinished" && myPb) {
          if (phase === "greeting") {
            phase   = "prompt";
            const pb = await ariHttp("POST", `/channels/${channelId}/play`, { media: soundRef(`${base}_prompt`) });
            curPbId  = pb?.id ?? "";
          } else if (phase === "prompt") {
            done("answered", "DTMF:none | No response");
          } else if (phase === "response") {
            done("answered", dtmfNote);
          }
        }

        if (evt.type === "ChannelDtmfReceived" && mine && (phase === "greeting" || phase === "prompt")) {
          const digit   = evt.digit as string;
          const matched = dtmfOptions.find((o: any) => o.key === digit);
          aiCallLog(detailId, "dtmf_press", { digit, label: matched?.label }, logCtx);
          if (matched) {
            ariHttp("DELETE", `/playbacks/${curPbId}`).catch(() => {});
            phase    = "response";
            dtmfNote = `DTMF:${digit} | ${matched.label} | outcome:${matched.outcome}`;
            const pb = await ariHttp("POST", `/channels/${channelId}/play`, { media: soundRef(`${base}_resp_${digit}`) });
            curPbId  = pb?.id ?? "";
          } else {
            done("answered", `DTMF:${digit} | No match`);
          }
        }

        if (["ChannelHangupRequest","ChannelDestroyed","StasisEnd"].includes(evt.type) && mine) {
          done(answered ? "answered" : "not_answered", dtmfNote || undefined);
        }
      },
      () => { if (!settled) done(answered ? "answered" : "not_answered"); }
    );
  });
}

// ── Mode: AI Conversation — delegated to FastAGI on FreePBX ──────
// The API server originates the call to the "ai-outbound" dialplan context.
// FreePBX runs ai-call-agi.js (FastAGI server) which handles all AI logic locally:
//   no SCP, no ARI audio commands — TTS files written directly to sounds dir.
// When done, the AGI script HTTP PATCHes /api/users/phone-ivr/ai/calls/:id/result
// which updates the DB. We read the DB after ChannelDestroyed to get the result.
async function dialAiConversation(detailId: number, phoneNumber: string, template: any): Promise<CallResult> {
  const lang      = template.language         ?? "hindi";
  const gender    = template.voice_gender     ?? "female";
  const maxTurns  = Number(template.ai_max_turns  ?? 10);
  const sysPrompt = (template.ai_system_prompt
    ?? "You are a helpful AI sales assistant on a phone call. Respond in Hindi. Keep replies SHORT — 1 to 2 sentences maximum. Be friendly and natural.")
    + " IMPORTANT: Reply in 1-2 sentences only. Do not use bullet points or lists.";
  const logCtx = { phoneNumber, callMode: "ai_conversation" };
  const t0     = Date.now();

  // AGI callback URL — hits the existing no-auth PATCH endpoint on this API server
  const apiBase     = (process.env.API_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
  const callbackUrl = `${apiBase}/api/users/auth/phone-ivr/ai/calls`;

  return new Promise<CallResult>((resolve) => {
    let channelId = "";
    let answered  = false;
    let settled   = false;
    const timer   = setTimeout(() => done(), CALL_TIMEOUT_MS);

    async function done() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (channelId) ariHttp("DELETE", `/channels/${channelId}`).catch(() => {});

      // Wait briefly for the AGI HTTP callback to reach the DB before reading
      if (answered) await new Promise(r => setTimeout(r, 2_000));

      const row: any = await (db as any)
        .selectFrom("phone_ivr_camp_details")
        .select(["status", "call_duration", "notes"])
        .where("id", "=", detailId)
        .executeTakeFirst()
        .catch(() => null);

      const status: CallResult["status"] =
        (row?.status && !["calling", "pp1"].includes(row.status))
          ? row.status
          : (answered ? "answered" : "not_answered");

      const dur = Math.round((Date.now() - t0) / 1000);
      aiCallLog(detailId, "ami_result", { status, duration_sec: answered ? dur : undefined }, logCtx);
      resolve({
        status,
        call_duration: row?.call_duration ?? (answered ? dur : undefined),
        call_sid:      channelId,
        notes:         row?.notes ?? undefined,
      });
    }

    withAriWs(
      async () => {
        // Originate to the "ai-outbound" dialplan context — AGI handles all audio on FreePBX
        const ch: any = await ariHttp("POST", "/channels", {
          endpoint:  buildEndpoint(phoneNumber),
          context:   "ai-outbound",
          extension: "s",
          priority:  1,
          ...(CALLER_ID ? { callerId: CALLER_ID } : {}),
          timeout:   60,
          variables: {
            AI_DETAIL_ID:     String(detailId),
            AI_GREETING:      (template.greeting || "Namaste! Kya aap ek minute baat kar sakte hain?").replace(/[\r\n]+/g, ' '),
            AI_SYSTEM_PROMPT: sysPrompt.replace(/[\r\n]+/g, ' '),
            AI_LANGUAGE:      lang,
            AI_GENDER:        gender,
            AI_MAX_TURNS:     String(maxTurns),
            AI_CALLBACK_URL:  callbackUrl,
            ...(template.voice_name      ? { AI_VOICE_NAME:     template.voice_name }      : {}),
            ...(template.language_code   ? { AI_LANGUAGE_CODE:  template.language_code }   : {}),
            ...(template.ssml_gender     ? { AI_SSML_GENDER:    template.ssml_gender }     : {}),
          },
        });
        channelId = ch.id;
        aiCallLog(detailId, "ami_sent", { channelId, endpoint: buildEndpoint(phoneNumber), max_turns: maxTurns }, logCtx);
      },
      async (_ws, evt) => {
        if (evt.channel?.id !== channelId) return;
        // ChannelStateChange to "Up" = remote party answered
        if (evt.type === "ChannelStateChange" && evt.channel?.state === "Up") {
          answered = true;
          aiCallLog(detailId, "call_result", { event: "ChannelUp", channelId }, logCtx);
        }
        if (["ChannelHangupRequest", "ChannelDestroyed"].includes(evt.type)) {
          await done();
        }
      },
      () => { if (!settled) done(); },
    );
  });
}

// ── Dispatcher ────────────────────────────────────────────────
async function dialNumber(detailId: number, phoneNumber: string, template: any): Promise<CallResult> {
  const mode = template.call_mode ?? "voice_blast";
  aiCallLog(detailId, "call_start", {
    phone: phoneNumber, mode, template: template.name, language: template.language,
  }, { phoneNumber, callMode: mode });
  if (mode === "dtmf")            return dialDtmf(detailId, phoneNumber, template);
  if (mode === "ai_conversation") return dialAiConversation(detailId, phoneNumber, template);
  return dialVoiceBlast(detailId, phoneNumber, template);
}

// ── Main job processor ────────────────────────────────────────
async function processJob(job: Job<PhoneAiCampaignJobData>): Promise<{ dialed: number; answered: number; failed: number }> {
  const { requestId, username } = job.data;

  const summary: any = await (db as any)
    .selectFrom("phone_ivr_camp_summury").selectAll()
    .where("request_id", "=", requestId).where("username", "=", username)
    .executeTakeFirst();
  if (!summary) throw new Error(`Campaign not found: ${requestId}`);
  if (summary.status === "cancelled") {
    console.log(`[phone-ai-campaign] ${requestId} cancelled — skipping`);
    return { dialed: 0, answered: 0, failed: 0 };
  }

  const template: any = await (db as any)
    .selectFrom("phone_ivr_template").selectAll()
    .where("id", "=", summary.template_id).where("username", "=", username)
    .executeTakeFirst();
  if (!template) throw new Error(`Template not found: ${summary.template_id}`);

  await (db as any).updateTable("phone_ivr_camp_summury")
    .set({ status: "running", updated_at: new Date() })
    .where("request_id", "=", requestId).execute();

  let totalDialed = 0, totalAnswered = 0, totalFailed = 0;

  while (true) {
    const fresh: any = await (db as any)
      .selectFrom("phone_ivr_camp_summury").select(["status"])
      .where("request_id", "=", requestId).executeTakeFirst();
    if (!fresh || ["paused","cancelled","completed"].includes(fresh.status)) {
      console.log(`[phone-ai-campaign] ${requestId} — status="${fresh?.status}", exiting`);
      break;
    }

    const batch = await claimBatch(requestId);
    if (batch.length === 0) break;

    await Promise.all(batch.map(async (row: any) => {
      try {
        const result = await dialNumber(row.id, row.phone_number, template);
        await markResult(row.id, result.status, { call_duration: result.call_duration, call_sid: result.call_sid, notes: result.notes });
        aiCallLog(row.id, "call_result", { status: result.status, duration_sec: result.call_duration, notes: result.notes },
          { requestId, username, phoneNumber: row.phone_number, callMode: template.call_mode });
        totalDialed++;
        if (result.status === "answered") totalAnswered++;
        else if (result.status === "failed") totalFailed++;
      } catch (err: any) {
        console.error(`[phone-ai-campaign] Error dialing ${row.phone_number}:`, err.message);
        await markResult(row.id, "failed", { notes: err.message });
        aiCallLog(row.id, "error", { message: err.message, stack: err.stack?.slice(0, 300) },
          { requestId, username, phoneNumber: row.phone_number, callMode: template.call_mode });
        totalDialed++;
        totalFailed++;
      }
    }));

    await refreshSummary(requestId);

    const pending = await (db as any)
      .selectFrom("phone_ivr_camp_details").select((db as any).fn.count("id").as("cnt"))
      .where("request_id", "=", requestId).where("status", "=", "pp1").executeTakeFirst();
    const remaining = Number((pending as any)?.cnt ?? 0);
    const pct = summary.total_numbers > 0
      ? Math.round(((summary.total_numbers - remaining) / summary.total_numbers) * 100) : 100;
    await job.updateProgress(Math.min(99, pct));

    if (remaining === 0) break;
    await new Promise((r) => setTimeout(r, POLL_DELAY_MS));
  }

  const { allDone } = await refreshSummary(requestId);
  if (allDone) console.log(`[phone-ai-campaign] ${requestId} COMPLETED — dialed=${totalDialed} answered=${totalAnswered} failed=${totalFailed}`);
  await job.updateProgress(100);
  return { dialed: totalDialed, answered: totalAnswered, failed: totalFailed };
}

// ── Recovery: re-enqueue orphaned running campaigns ───────────
async function recoverOrphanedCampaigns() {
  try {
    const { phoneAiCampaignQueue } = await import("../queues/phone-ai-campaign.queue.js");
    const running: any[] = await (db as any)
      .selectFrom("phone_ivr_camp_summury").select(["request_id","username"])
      .where("status", "=", "running").execute();
    if (running.length === 0) return;
    console.log(`[phone-ai-campaign] Recovering ${running.length} orphaned running campaign(s)...`);
    for (const c of running) {
      await phoneAiCampaignQueue.add(`campaign-${c.request_id}`,
        { requestId: c.request_id, username: c.username }, { jobId: c.request_id });
      console.log(`[phone-ai-campaign] Re-enqueued: ${c.request_id}`);
    }
  } catch (err: any) {
    console.error("[phone-ai-campaign] Recovery scan failed:", err.message);
  }
}

// ── Export starter ────────────────────────────────────────────
export function startPhoneAiCampaignWorker() {
  const worker = new Worker<PhoneAiCampaignJobData>("phone-ai-campaign", processJob, {
    connection: redisConnection as any, concurrency: 2,
  });
  worker.on("completed", (job, result) => console.log(`[phone-ai-campaign] Job ${job.id} done:`, result));
  worker.on("failed",    (job, err)    => console.error(`[phone-ai-campaign] Job ${job?.id} failed:`, err.message));
  worker.on("error",     (err)         => console.error("[phone-ai-campaign] Worker error:", err));
  setTimeout(recoverOrphanedCampaigns, 3000);
  console.log("[phone-ai-campaign] Worker started (concurrency=2)");
  return worker;
}
