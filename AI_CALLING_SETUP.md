# AI Calling Campaign — Server Setup Guide

> Keep this document private — it contains credentials structure and server details.

---

## Architecture Overview

```
[API Server 103.27.232.3]          [FreePBX Server 103.73.188.148]
        |                                        |
  BullMQ Worker                          Asterisk AMI :5038
  Google TTS → /tmp/ai_call_N.wav        /var/lib/asterisk/sounds/
        |                                        |
        |── SCP (port 22) ──────────────────────>|
        |── AMI Originate ───────────────────────>|
        |                                  PJSIP cloudjio trunk
        |                                  Dials phone number
        |                                  Plays ai_call_N.wav
        |<── OriginateResponse ───────────────────|
```

---

## Part 1 — Google Cloud TTS Setup

### 1.1 Get Service Account JSON Key

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Open **Cloud Shell** (top right terminal icon)
3. Run:
```bash
# Enable TTS API
gcloud services enable texttospeech.googleapis.com

# Create JSON key for existing service account
gcloud iam service-accounts keys create ~/tts-key.json \
  --iam-account=speech-api-access@YOUR_PROJECT_ID.iam.gserviceaccount.com

# View the file (copy contents)
cat ~/tts-key.json
```
4. Download via Cloud Shell → **⋮ menu → Download** → `/home/YOUR_USER/tts-key.json`

### 1.2 Upload to API Server

```bash
# From your local machine
scp -P 9575 tts-key.json root@103.27.232.3:/etc/tts-key.json

# On API server — secure the file
chmod 600 /etc/tts-key.json
```

### 1.3 Install google-auth-library

```bash
cd /var/www/html/shubham/lead-app/api-indew-lead-app
npm install google-auth-library
```

---

## Part 2 — FreePBX AMI Setup

### 2.1 Create Dedicated AMI User

SSH into FreePBX server and run:

```bash
cat > /etc/asterisk/manager_custom.conf << 'EOF'
[aicaller]
secret = aicaller@2025
deny=0.0.0.0/0.0.0.0
permit=127.0.0.1/255.255.255.0
permit=103.27.232.3/255.255.255.255
read = system,call,log,verbose,command,agent,user,config,dtmf,reporting,cdr,dialplan,originate,message
write = system,call,log,verbose,command,agent,user,config,dtmf,reporting,cdr,dialplan,originate,message
writetimeout = 5000
EOF

asterisk -rx "manager reload"
asterisk -rx "manager show users"
```

Expected output: `aicaller` appears in the list.

### 2.2 Open AMI Port on FreePBX Firewall

```bash
# Allow API server IP to reach AMI port
iptables -I INPUT -s 103.27.232.3 -p tcp --dport 5038 -j ACCEPT
```

### 2.3 Verify AMI Connection from API Server

```bash
# Run this on API server
bash -c "exec 3<>/dev/tcp/103.73.188.148/5038; cat <&3 &sleep 1; \
  echo -e 'Action: Login\r\nUsername: aicaller\r\nSecret: aicaller@2025\r\n\r\n' >&3; \
  sleep 1; kill %1 2>/dev/null" 2>/dev/null
```

Expected: `Response: Success` + `Authentication accepted`

---

## Part 3 — SSH Key Setup (API Server → FreePBX)

This allows the worker to SCP audio files to FreePBX.

```bash
# On API server — generate key pair
ssh-keygen -t rsa -b 4096 -f /root/.ssh/freepbx_tts -N ""

# Copy public key to FreePBX (FreePBX SSH port is 22)
ssh-copy-id -i /root/.ssh/freepbx_tts.pub -p 22 shubham@103.73.188.148

# Test passwordless login
ssh -i /root/.ssh/freepbx_tts -p 22 shubham@103.73.188.148 "echo SSH OK"
```

### 3.1 Fix Sounds Directory Permissions on FreePBX

```bash
# On FreePBX server
chmod 777 /var/lib/asterisk/sounds
# OR add user to asterisk group
usermod -aG asterisk shubham
chmod g+w /var/lib/asterisk/sounds
```

---

## Part 4 — Environment Variables (.env on API Server)

Add to `/var/www/html/shubham/lead-app/api-indew-lead-app/.env`:

```bash
# ── FreePBX AMI ──────────────────────────────────────
ASTERISK_AMI_HOST=103.73.188.148
ASTERISK_AMI_PORT=5038
ASTERISK_AMI_USER=aicaller
ASTERISK_AMI_SECRET=aicaller@2025
ASTERISK_CHANNEL_FMT=PJSIP/{number}@cloudjio
ASTERISK_CALLER_ID=
ASTERISK_SOUNDS_PATH=/var/lib/asterisk/sounds

# ── SSH to FreePBX (for SCP audio files) ─────────────
FREEPBX_SSH_HOST=103.73.188.148
FREEPBX_SSH_KEY=/root/.ssh/freepbx_tts
FREEPBX_SSH_USER=shubham
FREEPBX_SSH_PORT=22

# ── Google TTS ────────────────────────────────────────
GOOGLE_APPLICATION_CREDENTIALS=/etc/tts-key.json
```

---

## Part 5 — PM2 Worker

### 5.1 Start the Worker

```bash
pm2 start ecosystem.config.cjs --only apilead-worker-phone-ai-campaign
pm2 save
```

### 5.2 Check Logs

```bash
pm2 logs apilead-worker-phone-ai-campaign --lines 30
```

### 5.3 Restart After .env Changes

```bash
pm2 restart apilead-worker-phone-ai-campaign
```

---

## Part 6 — Database Setup

Run these SQL migrations once:

```bash
# migrations/phone_ai_calling.sql — creates 4 tables:
# phone_ai_credentials
# phone_ivr_template
# phone_ivr_camp_summury
# phone_ivr_camp_details
mysql -u DB_USER -p DB_NAME < migrations/phone_ai_calling.sql
```

---

## Part 7 — Quick Verification Checklist

Run these on the API server to verify everything is working:

```bash
# 1. Google TTS key exists
ls -la /etc/tts-key.json

# 2. SSH to FreePBX works
ssh -i /root/.ssh/freepbx_tts -p 22 shubham@103.73.188.148 "echo OK"

# 3. AMI connection works
bash -c "exec 3<>/dev/tcp/103.73.188.148/5038; cat <&3 & sleep 1; kill %1 2>/dev/null"

# 4. Worker is running
pm2 status | grep phone-ai

# 5. Env vars loaded
pm2 env 65 | grep ASTERISK
```

---

## Part 8 — New Server Migration Steps

When moving to a new API server:

1. **Copy .env** — update all IPs to new server
2. **Copy SSH key** → `/root/.ssh/freepbx_tts` + `/root/.ssh/freepbx_tts.pub`
3. **Copy tts-key.json** → `/etc/tts-key.json`
4. **Update FreePBX AMI permit** — add new server IP in `/etc/asterisk/manager_custom.conf`
5. **Update FreePBX iptables** — `iptables -I INPUT -s NEW_IP -p tcp --dport 5038 -j ACCEPT`
6. **Re-copy SSH key** → `ssh-copy-id -i /root/.ssh/freepbx_tts.pub -p 22 shubham@103.73.188.148`
7. **npm install** → `npm install google-auth-library`
8. **PM2 start** → `pm2 start ecosystem.config.cjs --only apilead-worker-phone-ai-campaign`

---

## Reference — Server Details

| Server     | IP              | SSH Port | Purpose              |
|------------|-----------------|----------|----------------------|
| API Server | 103.27.232.3    | 9575     | Node.js API + Workers|
| FreePBX    | 103.73.188.148  | 22       | Asterisk + SIP Trunk |

| Service        | Details                              |
|----------------|--------------------------------------|
| AMI User       | `aicaller` / `aicaller@2025`         |
| SIP Trunk      | `cloudjio` (PJSIP)                   |
| TTS Provider   | Google Cloud TTS (Hindi Wavenet)     |
| SSH Key Path   | `/root/.ssh/freepbx_tts`             |
| TTS Key Path   | `/etc/tts-key.json`                  |

---

*Generated: March 2026 | Project: Indew Lead App AI Calling*
