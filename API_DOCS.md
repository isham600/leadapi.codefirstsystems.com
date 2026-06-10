# Indew Lead — API Documentation

**Base URL:** `https://apilead.nuke.co.in`

---

## Authentication

All protected routes require a JWT Bearer token in the request header:

```
Authorization: Bearer <access_token>
```

The token is returned by `/loginUser` or `/refreshAccessToken`.

---

## Standard Response Format

```json
{
  "status": 1,          // 1 = success, 0 = error
  "statuscode": 200,
  "message": "...",
  "data": { ... }       // null on error
}
```

---

---

# MODULE 1 — Users & Auth

**Base path:** `/api/users/auth`

---

## Availability Checks

### `POST /api/users/auth/checkUsername`
Check if a username is already taken.

**Body:**
```json
{ "username": "john123" }
```

---

### `POST /api/users/auth/checkPhone`
Check if a phone number is already registered.

**Body:**
```json
{ "phone": "+919876543210" }
```

---

### `POST /api/users/auth/checkEmail`
Check if an email is already registered.

**Body:**
```json
{ "email": "john@example.com" }
```

---

## Authentication

### `POST /api/users/auth/registerUser`
Register a new user account.

**Body:**
```json
{
  "username": "john123",
  "email": "john@example.com",
  "phone": "+919876543210",
  "password": "Secret123!"
}
```

---

### `POST /api/users/auth/loginUser`
Login and receive JWT tokens.

**Body:**
```json
{
  "username": "john123",
  "password": "Secret123!"
}
```

**Response `data`:**
```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ..."
}
```

---

### `POST /api/users/auth/logout`
Logout the current session.

**Body:** _(empty)_

---

### `GET /api/users/auth/getLoggedUser` `JWT`
Get the currently authenticated user's profile.

**Response `data`:**
```json
{
  "username": "john123",
  "email": "john@example.com",
  "phone": "+919876543210",
  "role": "admin",
  "avatar": "https://..."
}
```

---

### `POST /api/users/auth/refreshAccessToken`
Exchange a refresh token for a new access token.

**Body:**
```json
{ "refresh_token": "eyJ..." }
```

**Response `data`:**
```json
{ "access_token": "eyJ..." }
```

---

## OTP — Login

### `POST /api/users/auth/sendOtp`
Send OTP to registered phone number.

**Body:**
```json
{ "phone": "+919876543210" }
```

---

### `POST /api/users/auth/verifyOtp`
Verify the OTP sent to phone.

**Body:**
```json
{
  "phone": "+919876543210",
  "otp": "123456"
}
```

---

### `POST /api/users/auth/sendOtpEmail`
Send OTP to email address.

**Body:**
```json
{ "email": "john@example.com" }
```

---

### `POST /api/users/auth/verifyEmailOtp`
Verify OTP sent to email.

**Body:**
```json
{
  "email": "john@example.com",
  "otp": "123456"
}
```

---

## OTP — Reset Password

### `POST /api/users/auth/resetSendOtp`
Send OTP to phone for password reset.

**Body:**
```json
{ "phone": "+919876543210" }
```

---

### `POST /api/users/auth/resetVerifyOtp`
Verify the password reset OTP.

**Body:**
```json
{
  "phone": "+919876543210",
  "otp": "123456"
}
```

---

### `POST /api/users/auth/resetPassword`
Set a new password after OTP is verified.

**Body:**
```json
{
  "phone": "+919876543210",
  "otp": "123456",
  "new_password": "NewSecret123!"
}
```

---

## Sessions

### `GET /api/users/auth/getLoginSession` `JWT`
Get all active login sessions for the current user.

---

### `PATCH /api/users/auth/updateLoginSession/:id` `JWT`
Update a specific login session.

**Params:** `id` — session ID

---

### `POST /api/users/auth/AllLogoutSession` `JWT`
Terminate all active sessions (logout everywhere).

---

## Profile

### `POST /api/users/auth/editUserProfile` `JWT`
Update user profile information.

**Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "+919876543210"
}
```

---

### `POST /api/users/auth/uploadAvatar` `JWT`
Upload a profile picture.

**Content-Type:** `multipart/form-data`

**Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `avatar` | file | Image file (jpg/png) |

---

### `POST /api/users/auth/checkPassword`
Verify a password (e.g. before sensitive action).

**Body:**
```json
{ "password": "Secret123!" }
```

---

### `POST /api/users/auth/changePasswordDashboard` `JWT`
Change password from inside the dashboard.

**Body:**
```json
{
  "current_password": "OldSecret123!",
  "new_password": "NewSecret123!"
}
```

---

## Two-Factor Authentication (2FA)

### `GET /api/users/auth/getAllQuestions` `JWT`
Get all available security questions for Q&A 2FA.

---

### `POST /api/users/auth/verifyQA`
Verify security question answer (public, used during login challenge).

**Body:**
```json
{
  "username": "john123",
  "answer": "My answer"
}
```

---

### `POST /api/users/auth/enableEmailDualVerification` `JWT`
Enable 2FA via email OTP.

---

### `POST /api/users/auth/enablePhoneDualVerification` `JWT`
Enable 2FA via SMS OTP.

---

### `POST /api/users/auth/enableQADualVerification` `JWT`
Enable 2FA via security Q&A.

**Body:**
```json
{
  "question_id": 3,
  "answer": "My answer"
}
```

---

### `POST /api/users/auth/enableDualVerification` `JWT`
Enable 2FA globally.

---

### `POST /api/users/auth/disableDualVerification` `JWT`
Disable 2FA.

---

## User Management

### `GET /api/users/auth/getUserAccounts` `JWT`
Get all sub-users created under the current account.

---

### `POST /api/users/auth/addUserClientManagement` `JWT` `RBAC`
Create a new sub-user.

**Body:**
```json
{
  "username": "agent01",
  "email": "agent@example.com",
  "phone": "+919876543210",
  "password": "Pass123!",
  "role": "agent"
}
```

---

### `PUT /api/users/auth/updateUserClientManagement/:id` `JWT` `RBAC`
Update a sub-user's details.

**Params:** `id` — user ID

---

### `PUT /api/users/auth/updateUserRoleClientManagement/:id` `JWT` `RBAC`
Update a sub-user's role.

**Params:** `id` — user ID

**Body:**
```json
{ "role": "manager" }
```

---

### `PUT /api/users/auth/toggleUserStatus/:id` `JWT`
Activate or deactivate a sub-user.

**Params:** `id` — user ID

---

### `GET /api/users/auth/getOverviewUsers` `JWT`
Get overview stats for all users under the account.

---

### `POST /api/users/auth/creditDeductSms` `JWT`
Deduct SMS credits from a user's balance.

---

### `GET /api/users/auth/transactions` `JWT`
Get credit transaction history.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `page` | number | Page number (default: 1) |
| `limit` | number | Results per page (default: 20) |

---

### `GET /api/users/auth/transactions/export` `JWT`
Export transactions as CSV/Excel.

---

## Activity Logs

### `GET /api/users/auth/activityLogs` `JWT`
Get audit trail / activity logs.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `page` | number | Page number |
| `limit` | number | Results per page |
| `from` | string | Start date (ISO) |
| `to` | string | End date (ISO) |

---

## Impersonation

### `POST /api/users/auth/impersonateUser` `JWT`
Admin logs in as a sub-user.

**Body:**
```json
{ "username": "agent01" }
```

---

### `POST /api/users/auth/endImpersonation` `JWT`
End impersonation and return to admin account.

---

## Agents

### `GET /api/users/auth/getagents` `JWT`
Get all agents assigned to the account.

---

### `PUT /api/users/auth/updateagents/:id` `JWT`
Update agent details.

**Params:** `id` — agent ID

---

## Leads

### `GET /api/users/auth/getLeads` `JWT`
Get all incoming leads with filters and pagination.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `page` | number | Page number (default: 1) |
| `limit` | number | Results per page (default: 20) |
| `search` | string | Search by name/email/phone |
| `source` | string | Filter by source |
| `status` | string | Filter by lead status |
| `from` | string | Start date (ISO) |
| `to` | string | End date (ISO) |

---

### `GET /api/users/auth/leads/:id` `JWT`
Get a single lead by ID.

**Params:** `id` — lead ID

---

### `POST /api/users/auth/leads-capture`
Public endpoint — capture a lead (used by web forms, Google Ads, etc.).

**Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "+919876543210",
  "source": "google",
  "uuid": "<webhook_uuid>"
}
```

---

### `POST /api/users/auth/sendSmsOtpForLead`
Send OTP to a lead's phone number for verification.

**Body:**
```json
{ "phone": "+919876543210" }
```

---

### `POST /api/users/auth/verifySmsOtpForLead`
Verify OTP for a lead.

**Body:**
```json
{
  "phone": "+919876543210",
  "otp": "123456"
}
```

---

## Webhooks

### `POST /api/users/auth/webhooks/:uuid`
Receive incoming lead webhooks (public).

**Params:** `uuid` — your unique webhook UUID

---

### `GET /api/users/auth/webhooks`
Facebook webhook verification endpoint (public). Facebook calls this to verify your webhook.

---

### `POST /api/users/auth/webhooks/facebook/:uuid`
Receive Facebook lead events (public).

**Params:** `uuid` — your unique webhook UUID

---

### `GET /api/users/auth/getFacebookWebhookUrl` `JWT`
Get your unique Facebook webhook URL.

**Response `data`:**
```json
{
  "webhookUrl": "https://apilead.nuke.co.in/api/users/auth/webhooks/facebook/abc123"
}
```

---

## Integrations

### `GET /api/users/auth/integrationStatus` `JWT`
Check connection status of all integrations.

**Response:**
```json
{
  "status": 1,
  "statuscode": 200,
  "message": "Integration status fetched",
  "data": {
    "whatsapp": "connected",    // "connected" | "disconnected"
    "googleads": "connected"    // "connected" | "disconnected"
  }
}
```

---

### `POST /api/users/auth/WHATSAPPINGREGATION` `JWT`
Connect a WhatsApp Business account.

---

### `POST /api/users/auth/createMetaIntegration` `JWT`
Connect a Meta (Facebook) account.

---

### `POST /api/users/auth/createEmailIntegration` `JWT`
Connect an email integration.

---

### `POST /api/users/auth/createGoogleIntegration` `JWT`
Connect a Google integration.

---

### `GET /api/users/auth/getGoogleAdsUrl` `JWT`
Get the Google OAuth URL to start Google Ads connection.

**Response `data`:**
```json
{
  "url": "https://apilead.nuke.co.in/api/google/oauth/start?token=<jwt>"
}
```

---

## WhatsApp Templates

### `GET /api/users/auth/syncWhatsappTemplates` `JWT`
Trigger a sync of WhatsApp templates from Meta. Returns immediately (202) — sync runs in background.

**Response:**
```json
{
  "status": 1,
  "statuscode": 202,
  "message": "Template sync queued for 2 account(s)",
  "data": { "accounts": 2 }
}
```

---

### `GET /api/users/auth/whatsappTemplates` `JWT`
Fetch synced WhatsApp templates with filters and pagination.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `page` | number | Page number (default: 1) |
| `limit` | number | Results per page (default: 20, max: 100) |
| `status` | string | `APPROVED` \| `PENDING` \| `REJECTED` \| `PAUSED` \| `DISABLED` |
| `category` | string | `UTILITY` \| `MARKETING` \| `AUTHENTICATION` |
| `template_type` | string | `STANDARD` \| `FLOW` \| `AUTH` \| `CAROUSEL` |
| `search` | string | Search by template name |
| `waba_id` | string | Filter by WABA ID |

**Response:**
```json
{
  "status": 1,
  "statuscode": 200,
  "message": "Templates fetched",
  "overview": {
    "total": 45,
    "approved": 38,
    "pending": 4,
    "rejected": 3,
    "marketing": 20,
    "utility": 22,
    "authentication": 3
  },
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "total_pages": 3,
    "has_next": true,
    "has_prev": false
  },
  "data": [
    {
      "id": 1,
      "waba_id": "123456789",
      "meta_template_id": "987654321",
      "name": "welcome_message",
      "language": "en_US",
      "category": "UTILITY",
      "status": "APPROVED",
      "template_type": "STANDARD",
      "header_type": "TEXT",
      "header_text": "Welcome!",
      "body_message": "Hello {{1}}, welcome to our service.",
      "footer_text": "Reply STOP to unsubscribe",
      "button_type": "QUICK_REPLY",
      "button_count": 2,
      "total_variable_count": 1,
      "synced_at": "2025-01-01T10:00:00Z",
      "updated_at": "2025-01-01T10:00:00Z"
    }
  ]
}
```

---

### `GET /api/users/auth/whatsappProfile` `JWT`
Get the connected WhatsApp Business profile.

---

## WhatsApp Campaign

### `POST /api/users/auth/whatsapp/campaign/submit` `JWT`
Submit a bulk WhatsApp campaign. Accepts numbers via CSV file or plain textarea. Returns immediately (202) — bulk insert runs in background.

**Content-Type:** `multipart/form-data`

**Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `campaign_name` | text | Yes | Name of the campaign |
| `template_name` | text | Yes | WhatsApp template name |
| `template_id` | text | Yes | Meta template ID |
| `waba_id` | text | Yes | WABA ID |
| `language` | text | Yes | Template language (e.g. `en_US`) |
| `csv_file` | file | No* | CSV file with phone numbers |
| `numbers_text` | text | No* | Newline-separated phone numbers |
| `csv-contain-media` | text | No | `"true"` if CSV has media URL column |
| `csv-contain-attributes` | text | No | `"true"` if CSV has attribute columns |
| `csv-contain-dynamic-url` | text | No | `"true"` if CSV has dynamic URL column |
| `header_media_url` | text | No | Static media URL for header |
| `attribute_1` ... `attribute_N` | text | No | Static attribute values for template variables |

> **Note:** Either `csv_file` or `numbers_text` must be provided.

**CSV format (with all options):**
```
phone,media_url,attr_1,attr_2,dynamic_url
+919876543210,https://media.com/img.jpg,John,Offer50,https://shop.com/promo
+918765432109,,Jane,Offer30,
```

**Response:**
```json
{
  "status": 1,
  "statuscode": 202,
  "message": "Campaign queued successfully",
  "data": {
    "campaign_id": "abc123",
    "total_numbers": 50000,
    "jobs_queued": 100
  }
}
```

---

## Dashboard

### `GET /api/users/auth/agentdashboard` `JWT`
Get dashboard data for the logged-in agent.

---

### `GET /api/users/auth/getadmindashboard` `JWT`
Get admin overview dashboard.

---

### `GET /api/users/auth/getLeadsDashboard` `JWT`
Get leads dashboard: recent leads, channel counts, weekly trends.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `page` | number | Page for lead list |
| `limit` | number | Results per page |
| `search` | string | Search leads |
| `from` | string | Start date (ISO) |
| `to` | string | End date (ISO) |

---

### `GET /api/users/auth/getAgentManagementDashboard` `JWT`
Get agent management dashboard: agent list, lead stats per agent.

**Query params:** same as `getLeadsDashboard`

---

## Reports

### `GET /api/users/auth/reports/source-attribution` `JWT`
Leads count and conversion rate by traffic source.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `from` | string | Start date (ISO) |
| `to` | string | End date (ISO) |
| `source` | string | Filter by source |

---

### `GET /api/users/auth/reports/conversion-stats` `JWT`
Detailed conversion stats broken down by source and pipeline stage.

**Query params:** same as source-attribution

---

### `GET /api/users/auth/reports/pipeline-health` `JWT`
Leads count by status (New, Qualified, Closed, etc.).

**Query params:** same as source-attribution

---

### `GET /api/users/auth/reports/team-productivity` `JWT`
Leads assigned and closed by each agent.

**Query params:** same as source-attribution

---

## Security

### `POST /api/users/auth/generateMasterPassword` `JWT`
Generate a master password for emergency access.

---

---

# MODULE 2 — Google Ads

**Base path:** `/api/google`

---

## Google OAuth

### `GET /api/google/oauth/start`
Start Google OAuth flow. Frontend should redirect the browser to this URL (not call via fetch).

**Query params:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | Yes | User's JWT access token |

**Usage from frontend:**
```js
window.location.href = `https://apilead.nuke.co.in/api/google/oauth/start?token=${accessToken}`;
```

**On success:** Google redirects back and user lands on:
```
https://yourfrontend.com/integrations?google_success=connected
```

**On error:** User lands on:
```
https://yourfrontend.com/integrations?google_error=<reason>
```

Error reasons: `not_configured` | `unauthorized` | `csrf_failed` | `session_expired` | `token_exchange_failed` | `server_error`

---

### `GET /api/google/oauth/callback`
Google OAuth callback. **Do not call directly** — this is only called by Google after the user approves access.

---

## Google Ads Data

### `DELETE /api/google/disconnect` `JWT`
Disconnect Google Ads integration and delete all synced data.

**Response:**
```json
{
  "status": 1,
  "statuscode": 200,
  "message": "Google Ads disconnected successfully",
  "data": null
}
```

---

### `GET /api/google/connection` `JWT`
Get Google Ads connection status and summary stats.

**Response:**
```json
{
  "status": 1,
  "statuscode": 200,
  "message": "Google Ads connection fetched",
  "data": {
    "status": "active",
    "connectedAt": "2025-01-01T10:00:00Z",
    "lastSyncedAt": "2025-01-15T08:30:00Z",
    "totalAccounts": 3,
    "totalLeads": 1240,
    "totalForms": 8
  }
}
```

If not connected:
```json
{
  "status": 0,
  "statuscode": 200,
  "message": "Google Ads not connected",
  "data": null
}
```

---

### `GET /api/google/accounts` `JWT`
Get all synced Google Ads accounts.

**Response:**
```json
{
  "status": 1,
  "statuscode": 200,
  "message": "Ad accounts fetched",
  "data": [
    {
      "id": 1,
      "customerId": "1234567890",
      "accountName": "My Business",
      "currencyCode": "INR",
      "isManagerAccount": false,
      "status": "ENABLED",
      "leadCount": 450,
      "leadFormCount": 3,
      "lastSyncedAt": "2025-01-15T08:30:00Z"
    }
  ]
}
```

---

### `GET /api/google/forms` `JWT`
Get all synced Google Ads lead forms.

**Response:**
```json
{
  "status": 1,
  "statuscode": 200,
  "message": "Lead forms fetched",
  "data": [
    {
      "id": 1,
      "formId": "987654321",
      "formName": "Home Loan Enquiry",
      "customerId": "1234567890",
      "accountName": "My Business",
      "status": "ENABLED",
      "leadCount": 230,
      "createdAt": "2025-01-01T10:00:00Z"
    }
  ]
}
```

---

### `GET /api/google/leads` `JWT`
Get synced Google Ads leads with search and pagination.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `page` | number | Page number (default: 1) |
| `limit` | number | Results per page (default: 20, max: 100) |
| `search` | string | Search by first name, last name, email, or phone |

**Response:**
```json
{
  "status": 1,
  "statuscode": 200,
  "message": "Leads fetched",
  "data": [
    {
      "id": 1,
      "formName": "Home Loan Enquiry",
      "accountName": "My Business",
      "firstName": "John",
      "lastName": "Doe",
      "email": "john@example.com",
      "phone": "+919876543210",
      "utmSource": "google",
      "utmCampaign": "summer2025",
      "gclid": "abc123xyz",
      "createdAt": "2025-01-10T14:22:00Z"
    }
  ],
  "meta": {
    "total": 1240,
    "page": 1,
    "limit": 20,
    "totalPages": 62,
    "hasNext": true,
    "hasPrev": false
  }
}
```

---

### `POST /api/google/leads/sync` `JWT`
Trigger a Google Ads leads sync. Returns immediately (202) — sync runs in background worker.

**Response:**
```json
{
  "status": 1,
  "statuscode": 202,
  "message": "Sync queued — processing in background worker",
  "data": null
}
```

---

---

# Error Responses

| HTTP Code | Meaning |
|-----------|---------|
| `400` | Bad Request — missing or invalid fields |
| `401` | Unauthorized — no token or token expired |
| `403` | Forbidden — insufficient permissions |
| `404` | Not Found |
| `422` | Validation error |
| `429` | Rate limit exceeded |
| `500` | Internal server error |

**Error format:**
```json
{
  "status": 0,
  "statuscode": 401,
  "message": "Unauthorized",
  "data": null
}
```

---

# Environment Notes

- Google Ads sync runs asynchronously — poll `GET /api/google/connection` to check `lastSyncedAt`
- WhatsApp template sync is asynchronous — re-fetch `/whatsappTemplates` after a few seconds
- Campaign submit is asynchronous — track job status via the returned `campaign_id`
- All dates are returned as ISO 8601 UTC strings
