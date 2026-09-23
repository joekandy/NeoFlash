# App Integration Manifest

Before building any app feature, check this manifest. Use platform integrations instead of reinventing functionality. Every integration listed here is already deployed and available to your app via simple fetch() calls.

If your runtime exposes `get_integration_docs`, prefer `get_integration_docs({ integrationName: "stripe-payments" })` for full API details and working code examples.
Otherwise, read `integrations/{id}/docs.md` by file path.

---

## Quick Lookup: "I need X, which integration do I use?"

| I need to... | Use this integration |
|---|---|
| Accept payments or subscriptions | `stripe-payments` |
| Accept payments in India with Razorpay (bring your own keys) | `razorpay-payments` |
| Make AI phone calls | `ai-phone-calls` |
| Send an email immediately | `inbound-email` |
| Schedule one-time or recurring emails | `task-scheduler` |
| Schedule tasks or recurring jobs | `task-scheduler` |
| Search the web | `web-search` |
| Scrape websites or social media | `web-scraping` |
| Generate text with AI (chatbot, content) | `openai-text-generation` |
| Generate text with Claude (Anthropic models) | `anthropic-text-generation` |
| Real-time voice conversation with AI | `openai-realtime` |
| Text-to-speech or music generation | `elevenlabs-audio` |
| Analyze images | `gemini-vision-transform` |
| Analyze or summarize videos | `gemini-video-understanding` |
| Generate images or videos with AI | `google-veo3` |
| Generate 3D models from text or images | `meshy-3d` |
| Generate cinematic images or videos with Higgsfield (Soul, Veo, DoP) | `higgsfield-media` |
| Analyze PDFs or documents | `document-analysis` |
| Transcribe audio/speech to text | `audio-transcription` |
| User authentication and sessions | `session-management` |
| Read, rename, or delete a customer conversation (chat history) | `space-chat` |
| Upload and store files/images | `file-storage` |
| Upload arbitrary binary files (video, PDF, audio) | `file-storage` |
| Extract frames from a video | `video-frames` |
| Trim or clip a video segment | `video-clip` |
| Render a custom video composition (Remotion) | `remotion-rendering` |
| Find royalty-free stock photos | `stock-photos` |
| Social feeds, posts, reactions, presence | `workspace-community` |
| Sell print-on-demand merchandise | `printify-products` |
| Run server-side logic (webhooks, hooks) | `server-functions` |
| React to a subscription being cancelled, renewed, or changed | `server-functions` (reserved name `subscription-events`) |
| React to a Flutterwave payment, including one started outside Audos | `server-functions` (reserved name `flutterwave-events`) |
| Let the customer-facing agent call tools mid-conversation (MCP) | `mcp-agent-tools` |
| Send only the tools a screen needs on a chat turn (`toolScope`) | `mcp-agent-tools` |
| Create public standalone pages | `permalink-pages` |
| Receive and process inbound emails | `inbound-email` |
| Automated email drip campaigns | `email-sequences` |
| Request human-in-the-loop tasks | `human-tasks` |
| Tag and segment CRM contacts | `crm-tags` |
| Search B2B leads | `apollo-leads` |
| Post to Slack channels | `slack` |
| Launch or manage Meta (Facebook/Instagram) ad campaigns | `meta-ads` |
| Connect a Meta / Facebook / Instagram account (in-app OAuth, connect-only) | `connect-meta` |
| Connect a Meta ad account in-app (with ads/launch surface) | `meta-ads` |
| Connect LinkedIn or Instagram in-app, then post | `social-publishing` |
| Publish posts to LinkedIn or Instagram | `social-publishing` |
| Track funnel/conversion events (Google Tag Manager, analytics) | `funnel-analytics` |
| Add SEO / social link-preview meta tags (description, Open Graph, Twitter cards) | `seo-social-previews` |

---

## Integration Reference

### ai-phone-calls
**Category:** Communication / Voice
Make and receive AI-powered phone calls on behalf of workspace customers using Retell AI or ElevenLabs.

| Endpoint | Purpose |
|----------|--------|
| `GET /api/workspaces/:workspaceId/phone/config` | Get Phone Config |
| `POST /api/workspaces/:workspaceId/phone/agents` | Create an Agent |
| `GET /api/workspaces/:workspaceId/phone/agents` | List Agents |
| `GET /api/workspaces/:workspaceId/phone/agents/:agentId` | Get a Specific Agent |
| `PATCH /api/workspaces/:workspaceId/phone/agents/:agentId` | Update an Agent's Prompt |
| `DELETE /api/workspaces/:workspaceId/phone/agents/:agentId` | Delete an Agent |

```
GET /api/workspaces/:workspaceId/phone/config
```

---

### alibaba-suppliers
**Category:** E-commerce / Sourcing
Find products and suppliers on Alibaba for any product idea. Search returns the product listing title, price range, a thumbnail image, and a link out to the Alibaba product page — everything an app needs to surface real sourcing options for a product idea.

| Endpoint | Purpose |
|----------|--------|
| `POST /api/suppliers/search` | API Endpoint |

```
POST /api/suppliers/search
```

---

### anthropic-text-generation
**Category:** AI/ML
Generate text, chatbots, content creation, and AI responses using Anthropic Claude models.

| Endpoint | Purpose |
|----------|--------|
| `POST /proxy/anthropic/v1/messages` | API Endpoint |

```javascript
const ws = (window as any).__workspaceDb;

const AUDOS_AI_HEADERS = {
  'Content-Type': 'application/json',
  'X-Workspace-DB-Token': ws?.token,
};
```

**Authentication is REQUIRED.** The proxy rejects anonymous calls with `401`
(`code: "no_credentials"`) before Anthropic is contacted. Send the workspace
token on every request:

```javascript
const ws = (window as any).__workspaceDb;

const response = await fetch('/proxy/anthropic/v1/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Workspace-DB-Token': ws?.token,
  },
  body: JSON.stringify({
    model: 'claude-sonnet-5',
    max_tokens: 1024,
    thinking: { type: 'disabled' },
    messages: [{ role: 'user', content: 'Hello!' }],
  }),
});
```

`POST /v1/messages` is the ONLY proxied Anthropic path — everything else
returns `404 unsupported_endpoint`. Only approved text models are accepted
(`400 unsupported_model`), `max_tokens` is capped at 8,192, and calls are
rate-limited per workspace. See
`integrations/anthropic-text-generation/docs.md` for the full contract.

---

### apollo-leads
**Category:** General
Search, enrich, and manage leads using Apollo.io's comprehensive B2B contact database. Find potential customers, partners, or media contacts for outreach.

```typescript
const response = await fetch('/api/leads/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: 'marketing automation',
    personTitles: ['VP Marketing', 'CMO', 'Director of Marketing'],
    personSeniorities: ['director', 'vp', 'c_suite'],
    includeSimilarTitles: true,
    limit: 25
  })
});

const { people, pagination } = await response.json();
// people[] contains name, title, company, email (if available), etc.
```

---

### audio-transcription
**Category:** AI/ML
Record audio and convert speech to text using OpenAI Whisper (default) or Deepgram nova-3. Simple POST endpoint for record-then-send transcription workflows.

| Endpoint | Purpose |
|----------|--------|
| `POST /api/generate/transcribe` | API Endpoint |

```
POST /api/generate/transcribe
```

---

### connect-meta
**Category:** Marketing
Form, read, and clear the workspace's Meta (Facebook/Instagram) connection from

| Endpoint | Purpose |
|----------|--------|
| `POST /api/workspaces/:workspaceId/marketing/connect/init` | Start the OAuth flow |
| `GET /api/workspaces/:workspaceId/marketing/connect/status` | Read connection status |
| `POST /api/workspaces/:workspaceId/marketing/connect/disconnect` | Disconnect |

```tsx
const ws = (window as any).__workspaceDb;
const base = `/api/workspaces/${ws.workspaceId}/marketing`;
const auth = { 'X-Workspace-DB-Token': ws.token };

// 1. Is an account already connected?
const { connected } = await fetch(`${base}/connect/status`, { headers: auth }).then((r) => r.json());

// 2. If not, start the OAuth flow and open the returned URL, then poll status.
if (!connected) {
  const { authUrl } = await fetch(`${base}/connect/init`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({}), // all scopes by default
  }).then((r) => r.json());
  window.open(authUrl, '_blank');
}
```

---

### crm-tags
**Category:** CRM
Manage contact and session tags for organizing and triggering automated boosters.

| Endpoint | Purpose |
|----------|--------|
| `POST /api/workspace-tags/:workspaceId` | Create a Tag |
| `GET /api/workspace-tags/:workspaceId` | List All Tags |
| `POST /api/entity-tags/contacts/:contactId/tags?workspaceId=:workspaceId` | Apply Tag to Contact |
| `POST /api/entity-tags/sessions/:sessionId/tags?workspaceId=:workspaceId` | Apply Tag to Session |
| `GET /api/entity-tags/contacts/:contactId/tags?workspaceId=:workspaceId` | Get Contact Tags |
| `GET /api/entity-tags/sessions/:sessionId/tags?workspaceId=:workspaceId&includeInherited=true` | Get Session Tags |

```
POST /api/workspace-tags/:workspaceId
```

---

### custom-api-keys
**Category:** Backend / Security
Use the founder's own third-party API keys in your app without ever exposing the secret value to the browser.

| Endpoint | Purpose |
|----------|--------|
| `POST /api/workspaces/:workspaceId/secrets/proxy` | Endpoint |

```
POST /api/workspaces/:workspaceId/secrets/proxy
Headers:
  Content-Type: application/json
  X-Workspace-DB-Token: <window.__workspaceDb.token>
Body (JSON):
  {
    "method": "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    "url": "https://api.example.com/v1/thing",   // HTTPS only; host must be allow-listed on every referenced key
    "query":   { ... },                          // optional
    "headers": { ... },                          // optional
    "json":    { ... },                          // optional — JSON body
    "form":    { ... },                          // optional — application/x-www-form-urlencoded body
    "body":    "raw string",                      // optional — raw body
    "responseType": "json" | "text" | "binary"   // optional — see "Response shape"
  }
Response:
  { "status": number, "headers": { ... }, "body": <upstream response body>, "encoding"?: "base64" }
```

---

### deepgram-transcription
**Category:** AI / Audio
Record audio and get back a transcript with **word-level timestamps** (word, start, end, confidence) powered by Deepgram nova-3. Use this instead of the plain-text `audio-transcription` integration whenever timing matters: pacing/prosody analysis, aligning the same phrase across recordings, karaoke-style transcript highlighting, silence detection.

| Endpoint | Purpose |
|----------|--------|
| `POST /api/workspaces/:workspaceId/audio/transcribe-timestamped` | API Endpoint |

```
POST /api/workspaces/:workspaceId/audio/transcribe-timestamped
```

---

### document-analysis
**Category:** AI/ML
Analyze images and PDFs with an AI vision model - extract data from invoices, forms, diagrams, and more. Supports native PDF processing (up to 100 pages, 32MB max).

| Endpoint | Purpose |
|----------|--------|
| `POST /api/analyze-document` | API Endpoint |

```
POST /api/analyze-document
```

---

### domain-registration
**Category:** General
Wallet-gated, idempotent purchase of new apex domains through DNSimple,

```json
{
  "domain": "myapp.com",
  "userConfirmed": true,
  "idempotencyKey": "optional-stable-key"
}
```

---

### elevenlabs-audio
**Category:** AI / Audio
Generate natural-sounding speech from text and create AI background music. Powered by ElevenLabs with 30+ premium voices and 8 music presets; background music can alternatively be rendered by Google Gemini (Lyria) via `provider: "gemini"`.

| Endpoint | Purpose |
|----------|--------|
| `GET /api/voices` | List Available Voices |
| `POST /api/workspaces/:workspaceId/demo-video/voiceover` | Generate Speech |
| `POST /api/workspaces/:workspaceId/demo-video/voiceover/segments` | Generate Segmented Speech |
| `POST /api/workspaces/:workspaceId/audio/voices` | Create a Cloned Voice |
| `GET /api/workspaces/:workspaceId/audio/voices` | List Workspace Voices |
| `DELETE /api/workspaces/:workspaceId/audio/voices/:voiceId` | Delete a Cloned Voice |
| `POST /api/workspaces/:workspaceId/audio/music/preset` | Generate Music from Preset (`provider`: `elevenlabs` default, or `gemini`) |
| `POST /api/workspaces/:workspaceId/audio/music/custom` | Generate Custom Music (`provider`: `elevenlabs` default, or `gemini`) |

```javascript
const ws = (window as any).__workspaceDb;

const AUDOS_AUDIO_HEADERS = {
  'Content-Type': 'application/json',
  'X-Workspace-DB-Token': ws?.token,
};
```

---

### email-sequences
**Category:** Marketing / Automation
Create multi-step automated email campaigns triggered by events, schedules, or manual actions.

| Endpoint | Purpose |
|----------|--------|
| `POST /api/workspaces/:workspaceId/email-sequences` | Create a Sequence |
| `GET /api/workspaces/:workspaceId/email-sequences` | List Sequences |
| `GET /api/workspaces/:workspaceId/email-sequences/:sequenceId` | Get Sequence Details |
| `PATCH /api/workspaces/:workspaceId/email-sequences/:sequenceId` | Update a Sequence |
| `DELETE /api/workspaces/:workspaceId/email-sequences/:sequenceId` | Delete a Sequence |
| `POST /api/workspaces/:workspaceId/email-sequences/:sequenceId/pause` | Pause / Resume a Sequence |

```
POST /api/workspaces/:workspaceId/email-sequences
```

---

### file-storage
**Category:** Storage
Permanently store images and files in Google Cloud Storage. Uploads are public by default; a private mode is available per upload.

| Endpoint | Purpose |
|----------|--------|
| `POST /api/upload/image` | Upload Image (base64 JSON) |
| `POST /api/upload/file` | Upload Any File (multipart binary) |
| `POST /api/upload/signed-url` | Upload a Large File (signed direct upload) |
| `DELETE /api/upload/file` | Delete an Uploaded File |
| `POST /api/upload/delete` | Delete an Uploaded File |
| `POST /api/upload/signed-delete` | Delete a Large Uploaded File |

```javascript
// Server function: keep the customer's upload private and email them a link
// that stops working in 15 minutes.
const stored = await platform.privateFiles.store({
  data: request.body.fileBase64,        // base64 sent by the page
  contentType: 'application/pdf',
  filename: request.body.filename,      // only used to pick the extension
  folder: 'contracts',
});

await db.insert('contracts', {
  email: request.body.email,
  file_key: stored.key,                 // store the KEY, never a link
});

const link = await platform.privateFiles.link(stored.key, { expiresInMinutes: 15 });
await platform.sendEmail({
  to: request.body.email,
  subject: 'Your contract',
  text: `Your contract: ${link.url} — the link expires in 15 minutes.`,
});

respond(200, { success: true, key: stored.key });
```

---

### funnel-analytics
**Category:** Analytics & Tracking
Fire funnel events into Google Tag Manager with `window.trackFunnelEvent`, and standard browser conversions into the workspace’s Meta Pixel with `window.__audosTrackMetaEvent`.


---

### gemini-video-understanding
**Category:** AI/ML
Analyze videos with Google's Gemini API to extract insights, summarize content, answer questions, and reference specific timestamps.

| Endpoint | Purpose |
|----------|--------|
| `POST /api/generate/video-analysis` | 1. Analyze Video (File Upload for videos >20MB) |
| `POST /api/generate/video-inline` | 2. Analyze Video (Inline for videos <20MB) |
| `POST /api/generate/video-youtube` | 3. Analyze YouTube Video |

```
POST /api/generate/video-analysis
```

---

### gemini-vision-transform
**Category:** General
Analyze images with Gemini Vision and transform them into new styles (line art, stylization, etc.) using AI-powered image-to-image processing.

`POST /api/generate/image-to-image` accepts optional `aspectRatio: "3:4"`,
`"4:3"`, `"4:5"`, or `"5:4"` for exact native Gemini portrait or landscape
edits. With no `model`, the platform selects `gemini-3-pro-image`; an explicit
OpenAI edit model with any of those ratios returns
`400 unsupported_aspect_ratio`. Responses preserve the provider's MIME type and
include the actual provider/model attempt history.

| Endpoint | Purpose |
|----------|--------|
| `POST /api/generate/vision` | 1. Vision Analysis — Describe or analyze an image |
| `POST /api/generate/image-to-image` | 2. Image-to-Image — Transform an image into a new style |

```
POST /api/generate/vision
```

---

### google-veo3
**Category:** AI/ML
Generate AI-powered videos and images using Google Veo (2 / 3 / 3.1), Gemini 2.5 Flash, or OpenAI DALL-E 3.

`POST /api/generate/image` supports image ratios `1:1`, `16:9`, `9:16`,
`3:4`, `4:3`, `4:5`, and `5:4`. Exact `3:4` / `4:3` / `4:5` / `5:4` requests
use managed Gemini image generation; other ratios use the platform's
OpenAI-first fallback chain. `quality: "hd"` requests 2K output on Gemini
(`"standard"` uses 1K). An optional `model: "gpt-image-2"` opts into GPT
Image 2 for OpenAI-compatible ratios, but combining that model with `3:4`,
`4:3`, `4:5`, or `5:4` returns `400 unsupported_aspect_ratio`. Responses
report the model that actually ran and preserve the provider's image MIME type.

| Endpoint | Purpose |
|----------|--------|
| `POST /api/generate/image` | API Endpoints |
| `POST /api/veo/generate/video` |  |
| `POST /api/generate/video` |  |
| `GET /api/veo/status/:operationId` |  |
| `POST /api/veo/generate-long-video` |  |
| `GET /api/veo/status-long-video/:jobId` |  |

```
POST /api/generate/image
```

---

### higgsfield-media
**Category:** AI / Media
Generate images and videos with Higgsfield AI - text-to-image (Popcorn),

```javascript
const res = await fetch('/api/generate/higgsfield/image', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: 'A neon-lit ramen shop at night', aspectRatio: '16:9' })
});
const { requestId } = await res.json();
```

---

### human-tasks
**Category:** General
Request, approve, track, and complete human tasks with wallet-based budgeting. Tasks go through an approval workflow before being posted to Slack.

| Endpoint | Purpose |
|----------|--------|
| `GET /api/human-tasks?workspaceId={workspaceId}` | List Tasks |
| `GET /api/workspace/{workspaceId}/human-tasks` | List Tasks |
| `POST /api/human-tasks` | Create Task |
| `POST /api/workspace/{workspaceId}/human-tasks` | Create Task |
| `POST /api/human-tasks/{taskId}/approve` | Approve Task |
| `POST /api/workspace/{workspaceId}/human-tasks/{taskId}/approve` | Approve Task |

```
GET /api/human-tasks?workspaceId={workspaceId}
GET /api/workspace/{workspaceId}/human-tasks
```

---

### image-and-video-generation
**Category:** General
Unified reference for the image and video generation endpoints exposed to apps built on the platform. The platform proxies requests to Google Veo, Google Gemini Omni Flash, OpenAI Sora, OpenRouter-hosted video models, OpenAI DALL-E 3, and Gemini Flash Image so apps don't have to manage provider keys themselves.

Image generation supports `1:1`, `16:9`, `9:16`, `3:4`, `4:3`, `4:5`, and
`5:4`. `POST /api/veo/generate/image` requires an explicit Gemini or DALL·E
model; `POST /api/generate/image` is platform-managed, with optional
`model: "gpt-image-2"` as the only model override. Exact `3:4` / `4:3` /
`4:5` / `5:4` requests use Gemini and reject that OpenAI override with
`400 unsupported_aspect_ratio`. Gemini preserves its returned MIME type and
uses 1K for standard quality or 2K for HD quality.

| Endpoint | Purpose |
|----------|--------|
| `GET /api/veo/status/:operationId` | Polling |

```javascript
// Character consistency across scenes: send the SAME character reference
// image(s) with every scene request.
const characterRef = { imageData: heroCharacterBase64, mimeType: 'image/png', referenceType: 'asset' };

for (const scenePrompt of scenePrompts) {
  const res = await fetch('/api/veo/generate/video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-omni-flash-preview',
      prompt: scenePrompt, // e.g. 'The same red-jacketed explorer crosses a rope bridge at dawn'
      aspectRatio: '16:9',
      duration: 8,
      referenceImages: [characterRef],
    })
  });
  const { operationId } = await res.json();
  // poll /api/veo/status/:operationId as usual
}
```

---

### inbound-email
**Category:** Communication
Receive, process, and auto-respond to emails on behalf of workspace customers using Mailgun inbound routing and server functions.

| Endpoint | Purpose |
|----------|--------|
| `POST /api/workspaces/:workspaceId/emails/send` | Send an Email |
| `GET /api/workspaces/:workspaceId/emails` | List Email Messages |
| `GET /api/workspaces/:workspaceId/emails/:messageId` | Get a Specific Email |
| `GET /api/workspaces/:workspaceId/emails/thread/:email` | Get Email Thread by Customer Email |
| `POST /api/mailgun/webhooks/inbound` | Inbound Webhook (Platform-Level) |
| `POST /api/workspaces/:workspaceId/hooks` |  |

```
Incoming Email → Mailgun → POST /api/mailgun/webhooks/inbound → Email Processor stores to workspace_email_messages → AI Chat Service auto-responds
```


**Who sent it (`senderIdentity`):** the inbound-email hook payload carries a
`senderIdentity` object resolved against **this** workspace's own records — an
account, a registration (browser, email or social signup) or a contact record all
count, so you never have to rebuild sender recognition inside your app.

```javascript
const { sender, senderIdentity } = request.body;
// { recognized, email, name, workspaceUserId, workspaceSessionUuid,
//   funnelContactId, emailVerified, knownToWorkspace, matchedOn }
if (senderIdentity.recognized && senderIdentity.emailVerified) { /* known customer */ }
```

A stranger arrives with an explicit `recognized: false` block rather than a blank
one, so "unknown sender" is distinguishable from "not looked up". Identities are
scoped to the receiving workspace — an account with the same address elsewhere is
never borrowed. This reports identity only; whether the sender is *allowed* to do
anything stays your app's decision.

---

### kling-video
**Category:** AI / Media / Video
Generate high-quality videos with Kling AI — text-to-video, image-to-video, multi-image/Elements

```javascript
// window.__workspaceDb is injected by the platform into every published space app.
const token = window.__workspaceDb.token;

const res = await fetch('/api/generate/kling/text-to-video', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Workspace-DB-Token': token,   // required — authenticates AND identifies the workspace
  },
  body: JSON.stringify({
    prompt: 'A golden retriever running through autumn leaves in slow motion',
    mode: 'std',
    duration: '5',
    aspectRatio: '16:9',
  }),
});
const { taskId } = await res.json();
```

---

### mcp-agent-tools
**Category:** General
Register **MCP tools** that THIS workspace's customer-facing agent can call

| Endpoint | Purpose |
|----------|--------|
| `GET /api/workspace-settings/{workspaceId}/customer-tools` | Read the registry |
| `PUT /api/workspace-settings/{workspaceId}/customer-tools` | Replace the registry |

```json
{
  "version": 1,
  "tools": [
    {
      "name": "add_to_catalog",
      "description": "Add an item to the shared catalog when the visitor asks to save or share something.",
      "parameters": {
        "name": { "type": "string", "required": true, "description": "Item name" },
        "description": { "type": "string", "required": false, "description": "Optional details" }
      },
      "action": {
        "type": "api_call",
        "method": "POST",
        "endpoint": "/api/hooks/execute/workspace-{configId}/add-to-catalog",
        "bodyMapping": { "name": "name", "description": "description" }
      }
    }
  ]
}
```

A read-shaped tool with no required parameters (GET, or POST that sends no arguments — the hook-backed read shape) may set `"preload": true` (max 3 per workspace) to be fetched before the conversation's first model call and handed to the agent up front, under a `## Preloaded Data` block — it removes the round trips the agent would otherwise spend discovering and fetching it. See `integrations/mcp-agent-tools/docs.md`.
Every registered tool's full definition is sent to the model on every turn as a fixed cost, so a large registry eats the context window before the visitor types. A chat request may carry `"toolScope": ["tool_a", "tool_b"]` to send only the definitions that screen needs for that one turn — narrowing only (unknown names are ignored, it can never introduce a tool, omitting it sends everything as before). See `integrations/mcp-agent-tools/docs.md`.
A successful customer-tool result is handed to the model in full up to 50,000 (`CUSTOMER_TOOL_RESULT_MAX_CHARS`) characters of pretty-printed JSON. A larger hook `respond()` is refused with `customer_tool_result_too_large` — the platform never silently truncates. Keep hook payloads under that limit (page, summarize, or drop unused fields). See `integrations/mcp-agent-tools/docs.md`.

---

### meshy-3d
**Category:** AI / 3D
Generate 3D models from text prompts or reference images using Meshy AI — the platform proxies requests so apps never manage the Meshy key, polling, or wallet billing.

| Endpoint | Purpose |
|----------|--------|
| `POST /api/generate/3d/text` | `POST /api/generate/3d/text` |
| `POST /api/generate/3d/image` | `POST /api/generate/3d/image` |
| `GET /api/generate/3d/status/:taskId` | `GET /api/generate/3d/status/:taskId` |

```
POST /api/generate/3d/text
```

---

### meta-ads
**Category:** Marketing / Advertising
Read, control, and launch Meta (Facebook/Instagram) ad campaigns through the

| Endpoint | Purpose |
|----------|--------|
| `GET /api/workspaces/:workspaceId/marketing/ads/insights?level=campaign&objectId={metaId}&datePreset=last_30d` | Read Insights |
| `POST /api/workspaces/:workspaceId/marketing/ads/live-status` | Live Delivery Status (batch) |
| `POST /api/workspaces/:workspaceId/marketing/ads/object-status` | Pause / Activate / Archive an Object |
| `GET /api/workspaces/:workspaceId/marketing/ads/campaigns/{metaCampaignId}/adsets` | List Ad Sets in a Campaign |
| `GET /api/workspaces/:workspaceId/marketing/ads/adsets/{metaAdSetId}/ads` | List Ads in an Ad Set |
| `POST /api/workspaces/:workspaceId/marketing/ads/launch` | Launch a Paid Campaign |

```tsx
// Connect a Meta account in-app, then read campaign insights.
const ws = (window as any).__workspaceDb;
const base = `/api/workspaces/${ws.workspaceId}/marketing`;
const auth = { 'X-Workspace-DB-Token': ws.token };

// 1. Is an account already connected?
const { connected } = await fetch(`${base}/connect/status`, { headers: auth }).then((r) => r.json());

// 2. If not, start the OAuth flow and open the returned URL, then poll status.
if (!connected) {
  const { authUrl } = await fetch(`${base}/connect/init`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ scopes: ['ads'] }),
  }).then((r) => r.json());
  window.open(authUrl, '_blank');
}

// 3. Once connected, read performance.
const insights = await fetch(`${base}/ads/insights?level=campaign&objectId=CAMPAIGN_ID`, {
  headers: auth,
}).then((r) => r.json());
```

---

### openai-realtime
**Category:** AI/ML
Real-time voice conversations with AI using OpenAI's Realtime API.

| Endpoint | Purpose |
|----------|--------|
| `GET /api/realtime/token` | API Endpoint |

```javascript
import { RealtimeAgent, RealtimeSession } from '@openai/agents-realtime';

export async function startVoiceSession({
  tools = [],
  toolChoice = 'none',
} = {}) {
  const response = await fetch('/api/realtime/token');
  if (!response.ok) throw new Error('Failed to get realtime token');
  const { token, model } = await response.json();

  const agent = new RealtimeAgent({
    name: 'Assistant',
    instructions: 'You are a helpful voice assistant.',
    tools,
  });

  const session = new RealtimeSession(agent, {
    model,
    // Tools remain disabled unless the caller explicitly passes "auto".
    config: { toolChoice },
  });
  await session.connect({ apiKey: token });
  return session;
}

// Explicit tool opt-in:
// await startVoiceSession({ tools: myTools, toolChoice: 'auto' });
```

---

### openai-text-generation
**Category:** AI/ML
Generate text, chatbots, content creation, and AI responses using OpenAI GPT models.

| Endpoint | Purpose |
|----------|--------|
| `POST /proxy/openai/v1/chat/completions` | API Endpoint |
| `POST /proxy/openai/v1/audio/speech` | API Endpoint |

```javascript
const ws = (window as any).__workspaceDb;

const AUDOS_AI_HEADERS = {
  'Content-Type': 'application/json',
  'X-Workspace-DB-Token': ws?.token,
};
```

**Authentication is REQUIRED.** The proxy rejects anonymous calls with `401`
(`code: "no_credentials"`) before OpenAI is contacted. Send the workspace token
on every request:

```javascript
const ws = (window as any).__workspaceDb;

const response = await fetch('/proxy/openai/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Workspace-DB-Token': ws?.token,
  },
  body: JSON.stringify({
    model: 'gpt-5.6-terra',
    reasoning_effort: 'none',
    messages: [{ role: 'user', content: 'Hello!' }],
    max_completion_tokens: 1000,
    stream: false,
  }),
});
```

`POST /v1/chat/completions` and `POST /v1/audio/speech` are the only proxied
OpenAI paths — model listing, embeddings, image generation, transcription,
video, batches and fine-tuning all return `404 unsupported_endpoint`. Chat
accepts only approved text models (`400 unsupported_model`); speech accepts
`tts-1` and `tts-1-hd` and returns audio bytes (not JSON).
Chat output is capped at 8,192 tokens, and calls are rate-limited per
workspace. Streaming works on chat; the terminal usage chunk has an
empty `choices` array, so read deltas with `event.choices?.[0]?.delta?.content`.
See `integrations/openai-text-generation/docs.md` for the full contract.

---

### permalink-pages
**Category:** Content / Publishing
Generate standalone, publicly accessible pages at unique URLs — static HTML or compiled React/TSX apps.

| Endpoint | Purpose |
|----------|--------|
| `POST /api/workspaces/:workspaceId/permalink-pages` | Create a Permalink Page |
| `GET /api/workspaces/:workspaceId/permalink-pages` | List Permalink Pages |
| `GET /api/workspaces/:workspaceId/permalink-pages/:pageId` | Get a Permalink Page |
| `PATCH /api/workspaces/:workspaceId/permalink-pages/:pageId` | Update a Permalink Page |
| `POST /api/workspaces/:workspaceId/permalink-pages/:pageId/recompile` | Recompile a TSX Page |
| `DELETE /api/workspaces/:workspaceId/permalink-pages/:pageId` | Delete a Permalink Page |

```
POST /api/workspaces/:workspaceId/permalink-pages
```

---

### printify-products
**Category:** E-commerce / Print-on-Demand
Create and sell custom branded merchandise (t-shirts, hoodies, mugs, etc.) using Printify's print-on-demand platform with real-time mockup previews.

| Endpoint | Purpose |
|----------|--------|
| `GET /api/printify/shops` | Get Shops |
| `GET /api/printify/catalog/blueprints` | Get Product Catalog (Blueprints) |
| `GET /api/printify/catalog/blueprints/:blueprintId/providers` | Get Print Providers for Blueprint |
| `GET /api/printify/catalog/blueprints/:blueprintId/providers/:providerId/variants` | Get Variants for Blueprint/Provider |
| `POST /api/printify/uploads` | Upload Design Image |
| `GET /api/proxy/image?url=<encoded-url>` | Proxy External Images (CORS) |

```
GET /api/printify/shops
```

---

### razorpay-payments
**Category:** General
Accept payments and subscriptions in your Space with Razorpay, using your own Razorpay account keys. Built for founders in India who want customers to pay in INR through Razorpay's hosted checkout.

```typescript
// One-time purchase: Rs 499.00
const { checkoutUrl } = await fetch('/api/payments/checkout', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-App-Id': window.__APP_ID__ || window.__SPACE_ID__ },
  body: JSON.stringify({
    amount: 49900,            // paise (49900 = Rs 499.00)
    currency: 'INR',
    productName: 'My Product',
    customerEmail: 'customer@example.com',
    successUrl: window.location.origin + '/success',
    cancelUrl: window.location.href,
    metadata: { paymentMode: 'razorpay' }
  })
}).then(r => r.json());

// Redirect to Razorpay's hosted payment page
window.location.href = checkoutUrl;
```

---

### remotion-rendering
**Category:** Media / Video
Render arbitrary Remotion compositions to MP4 server-side. Submit a TSX composition + props, get back a job ID, then poll for the final video URL.

| Endpoint | Purpose |
|----------|--------|
| `POST /api/render/remotion` | Submit Render Job |
| `GET /api/render/remotion/:operationId` | Get Render Status |

```tsx
const compositionTsx = `
import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';

export default function Composition({ title }: { title: string }) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: '#000', color: '#fff', alignItems: 'center', justifyContent: 'center' }}>
      <h1>{title} {frame}</h1>
    </AbsoluteFill>
  );
}

export const calculateDemoVideoDuration = () => 90;
`;

const response = await fetch('/api/render/remotion', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    workspaceId,
    compositionTsx,
    props: { title: 'Hello' },
    durationInFrames: 90,
  }),
});
const { operationId } = await response.json();
```

---

### seo-social-previews
**Category:** Hosting & SEO
Published space apps emit **no** `description`, `og:*`, or `twitter:*` meta tags by default. To get a search snippet and link previews (iMessage, WhatsApp, Slack, Facebook, X/Twitter), add the tags yourself through the workspace `custom_head_html` setting — this doc explains exactly what the platform emits on each surface and how to add what's missing.

| Endpoint | Purpose |
|----------|--------|
| `GET /api/workspace-settings/:workspaceId/custom_head_html` | Read / write the setting |
| `PUT /api/workspace-settings/:workspaceId/custom_head_html` | Read / write the setting |

```ts
// Read the current value first — ALWAYS merge, never blind-overwrite (see gotchas).
const current = await fetch(
  `/api/workspace-settings/${workspaceId}/custom_head_html?default=`,
).then((r) => r.json());

const tags = `
<meta name="description" content="Handmade dog collars, shipped in 48 hours." />
<meta property="og:title" content="Collar & Co" />
<meta property="og:description" content="Handmade dog collars, shipped in 48 hours." />
<meta property="og:image" content="https://cdn.example.com/og-preview.png" />
<meta property="og:type" content="website" />
<meta name="twitter:card" content="summary_large_image" />
`.trim();

await fetch(`/api/workspace-settings/${workspaceId}/custom_head_html`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ value: [current.value, tags].filter(Boolean).join('\n') }),
});
// Then re-publish the space so the compiled bundle picks up the new head.
```

---

### server-functions
**Category:** Backend / Server Logic
Define server-side handler functions that receive HTTP requests at unique URLs per workspace.

**Messaging a person from a function: `platform.postAgentMessage()` has TWO destinations and the default is NOT the founder's chat.** The default `destination: 'space_chat'` writes into a workspace SESSION's space chat — the visitor-facing surface the desktop workspace no longer renders — so an automation addressed to the owner reports success every run and is invisible to them. `destination: 'founder_chat'` writes into the founder's own Otto conversation (My Plan) and appears live with no reload. Use `'founder_chat'` for anything addressed to the founder/owner (digests, alerts, "your job finished") and the default only for messages addressed to a customer in a space conversation. Each automation reuses ONE ongoing founder conversation named after the function, and a retried run of the same occurrence is suppressed (`duplicate: true`), so never mirror to both destinations and never add your own dedupe table. Both destinations — and the dry run — return `deliveredTo`, a plain sentence naming the conversation the message went to; an unrecognised `destination` throws rather than falling back. See the "platform.postAgentMessage" section of the integration docs.

Platform-pushed triggers: a function registered under the reserved name `inbound-email` receives inbound mail, and one registered (enabled) under the reserved name `subscription-events` with the opt-in marker `audos:subscription-events` in its code receives subscription lifecycle events (`customer.subscription.created` / `.updated` / `.deleted`) in the provider's own event shape, already signature-verified by the platform. Nomination is the opt-in — a workspace without that function receives nothing. A third reserved name, `flutterwave-events` (marker `audos:flutterwave-events`), receives this workspace's Flutterwave events in Flutterwave's own shape — including payments started outside Audos — from the ONE shared webhook address a Flutterwave account registers. See the "Reacting to Workspace Events" section of the integration docs. A fourth, non-reserved trigger runs after a SUCCESSFUL PUBLISH: the workspace owner names any registered function in the `publish_completed_hook` workspace setting (empty by default, refused if the name is not registered) and the platform calls it with `{ event: "publish.completed", workspaceId, spaceId, publishedAt, cause, publishCount, _audos }`, where `cause` is only ever `founder_publish` or `coding_agent` — platform-owned repair/seed republishes are excluded. It runs the function and NOTHING ELSE: it never re-registers, redeploys or rebuilds a function, and a running function still cannot write the registry. No loops (a publish from inside a triggered run does not re-fire), no stacking (60-second minimum interval, publishes coalesce into one run and `publishCount` reports how many), self-pauses after 5 consecutive failures until the setting is saved again, and the publish never waits for it or fails because of it.

Signed webhooks: `request.rawBody` carries the exact transmitted text (JSON/urlencoded execute calls only; `null` for multipart, non-UTF-8, bodies over 2 MB, and platform-triggered runs with no HTTP request), and `platform.crypto.hmac({ secret, payload, algorithm?, encoding? })` plus `platform.crypto.timingSafeEqual(a, b)` compute and compare the digest. Private-key signing: `platform.crypto.signJwt({ secretName, claims, algorithm?, header?, keyId?, expiresIn? })` mints a signed JWT (RS256 default — Google service accounts and Wallet; ES256 for an Apple `.p8`) and `platform.crypto.sign({ secretName, content | contentBase64, algorithm?, encoding?, dsaEncoding? })` returns a raw signature, both using a private key held in the workspace secret store that the function NAMES but never sees — `await` them, 50 calls per execution, typed refusals (`unknown_secret`, `secret_disabled`, `invalid_key`, `key_algorithm_mismatch`, `key_passphrase_required`, `content_too_large`, `budget_exceeded`). A whole Google service-account JSON works as stored and defaults `iss`/`kid`/`iat`. Never paste a private key into function source or hand-write RSA in JavaScript. Hashing, comparison and signing only — no randomness, encryption, or key generation/storage, and no provider-specific verifier. See the "`request.rawBody`" and "platform.crypto" sections of the integration docs.

**Registry state from inside a function:** `platform.serverFunctions.self()` and
`platform.serverFunctions.list()` return read-only metadata for this workspace's
server functions — `name`, `description`, `enabled`, `status`, `statusReason`,
`codeUpdatedAt`, `lastExecutedAt`, `executionCount`, `hasEverRun`, `lastError`
(redacted, 500 chars), `createdAt`, `codeFingerprint` —
**including functions that have never run**. `codeFingerprint` is the sha256 of
the registered source's UTF-8 bytes, lowercase hex, and covers the code and
nothing else.
Never source or secrets, never another workspace, and never writable: change /
enable / disable / redeploy / invoke throw a stated refusal.

**The registry's web endpoints (`/api/workspaces/:workspaceId/hooks…`) answer
`401` to a running server function — that refusal is permanent — but they are
not closed to everyone.** An external caller holding a workspace API key with
the `hooks:manage` scope can list, read, create and update this workspace's
functions with no browser; deleting one still needs a person or an agent. That
is the headless deploy path (see "Deploying without a browser"). To find what
actually needs re-registering, sha256 the bytes you are about to send and
compare them with `codeFingerprint` — equal means already registered, skip the
write. The platform never registers a function from a same-named file in the
space tree, and the registry stores no source path and no source hash.

**Validated visitor sessions are opt-in per function.** Set `executeAuth:
"workspace_session"` with `manage_server_functions` or
`workspace_server_functions` to reject missing, fabricated, unusable, and
cross-workspace sessions before code runs when space OTP
is enabled. OTP-disabled workspaces retain the documented legacy registration
allowance. Then read the
validated `session.id` / `session.email` globals — never trust an email in the
request body or parse identity from a session string. Do not enable this on a
timer-, inbound-email-, payment-event-, post-publish-, credential-login/logout-, or phone-triggered
function because those calls have no visitor session.

| Endpoint | Purpose |
|----------|--------|
| `GET /api/workspaces/665201/hooks` |  |
| `GET /api/workspaces/workspace-665201/hooks` |  |
| `GET /api/workspaces/8a8181a4-.../hooks` |  |
| `POST /api/workspaces/:workspaceId/hooks` | Create a Hook |
| `GET /api/workspaces/:workspaceId/hooks` | List Hooks |
| `GET /api/workspaces/:workspaceId/hooks/:hookId` | Get a Hook |

```javascript
// webServiceURL: https://audos.com/api/hooks/execute/workspace-123456/pass-api
// GET    /v1/devices/:deviceId/registrations/:passTypeId        -> changed serials
// POST   /v1/devices/:deviceId/registrations/:passTypeId/:serial -> register
// DELETE /v1/devices/:deviceId/registrations/:passTypeId/:serial -> unregister
// GET    /v1/passes/:passTypeId/:serial                          -> updated .pkpass
const parts = request.subPath.split('/').filter(Boolean);
```

#### Credential Sign-In Hooks (NEW generated apps only)

Platform email OTP is the default for generated apps. If a new app explicitly
requires its own password or other credential, keep the verifier in a
registered Server Function and create a paired sign-in/logout hook contract.
The sign-in hook must accept `POST`, reject bad credentials explicitly, and
return a stable subject plus normalized email only after the real server-side
verifier succeeds. Never return password hashes, salts, or credential material.

A response shape alone is not authority. The platform-owned, reviewed binding
pins the workspace, immutable hook ID, exact code hash/version, allowed `POST`
method, accepted status/predicate, subject and email extractors, expiry, and
credential authority. A name, hook metadata field, request header,
`_meta.success`, or lookalike response cannot opt a hook in. Editing the
registered source invalidates recognition until the new version is reviewed.
Page JavaScript cannot create or update this binding.

The browser caller uses a root-relative, same-origin URL and
`credentials: 'include'`; the browser supplies `Origin`. On a recognized
success, the platform may set a signed HttpOnly `hook_credential` cookie without
changing the hook's status or body. That grant is scoped to private WorkspaceDB
identity. It is not OTP/email-possession verification and cannot confer founder,
delegation, mailroom, or other strict-email authority.

Until a reviewed binding exists for that exact hook version — and by default
none does — a hook success creates NO platform session. A stored "signed in"
record that carries no platform session id must never count as signed in: the
platform reads that browser as an anonymous visitor, so the person's private
rows stay invisible and every private write is refused with
`SESSION_VERIFICATION_REQUIRED`. Clear such a record and send the person back
through platform OTP.

Never tell page JavaScript to set `verified`, `sessionVerified`,
`canonicalSessionId`, `workspaceSessionId`, or `X-Session-Id` for this flow.
Generate a paired, reviewed `POST` logout hook so the platform can revoke the
grant and clear the cookie. If no reviewed binding is available, use platform
OTP rather than shipping a custom flow that assumes a response mints identity.

Existing deployed apps do not need to adopt this contract, change hooks, or
republish. Their recognition is handled separately by platform-owned fleet
review.

```javascript
/*
 * NEW generated apps only: call this registered POST hook from a root-relative,
 * same-origin fetch with credentials: 'include'.
 * A response shape alone is not authority; only a platform-owned binding for
 * this exact hook ID and code version can establish scoped WorkspaceDB identity.
 * Never set platform verification or session fields in page JavaScript.
 * Existing deployed apps do not need to adopt this contract.
 */
function finishCredentialSignIn(credentialUser) {
  // credentialUser must come from this hook's genuine server-side verifier.
  if (!credentialUser?.id || !credentialUser?.email) {
    respond(401, { success: false, error: 'Invalid credentials' });
    return;
  }

  respond(200, {
    success: true,
    user: {
      id: String(credentialUser.id),
      email: credentialUser.email,
    },
  });
}
```

For logout, complete any app-specific cleanup and return the reviewed logout
hook's configured success response:

```javascript
respond(200, { success: true });
```

---

---

### session-management
**Category:** Authentication
User authentication and session handling with secure state management, including email verification via OTP.

Generated Space apps support email OTP alongside optional **Google Sign-In
(Beta)** for end users of published founder-built workspace apps. Google
Sign-In never authenticates Audos founder/admin accounts; Audos founder/admin
login remains email OTP only.

Each workspace founder/admin supplies that workspace's own Google OAuth 2.0
client ID and client secret. Audos provides no shared platform Google client.
Generic BYOK/custom API keys are not the setup path. Create the credential in
Google Cloud as a **Web application**, then
open **Workspace → Integrations → Google Sign-In**.

Google's client form has two URI boxes. It shows **Authorized JavaScript
origins** first; this server-side flow does not use it, so leave that box
empty. Redirect URIs pasted there are rejected with `Invalid Origin: URIs must
not contain a path or end with "/"` — clear that box and use the **Authorized
redirect URIs** box below it instead.

The card displays every exact Authorized redirect URI for the platform host,
default workspace host,
and any verified custom/secondary-domain hosts. Copy **all** displayed URIs
into Google Cloud; every URI ends in
`/api/auth/social/google/callback`. The URI set is workspace/domain-specific,
not one global platform callback, and the card is the authoritative source for
the exact values.

Setup order is **save credentials → copy all displayed redirect URIs into
Google Cloud → enable → test**. Enabling injects the `google` provider into the
published EmailGate at serve time, so enabling/disabling does not require an app
republish. Separate security-template rollout or compatibility requirements,
when applicable, remain governed by their own rollout guidance.

| Endpoint | Purpose |
|----------|--------|
| `POST /api/space/{spaceId}/register` | Register a Provisional Session |
| `POST /api/auth/otp/space/send` | Send an OTP Code |
| `POST /api/auth/otp/space/verify` | Verify OTP and Return the Canonical Session |
| `GET /api/auth/otp/space/check-session?workspaceId={workspaceId}&sessionUuid={sessionUuid}` | Look Up an Exact Verified Session |
| `GET /api/auth/otp/space/check-session?workspaceId={workspaceId}` | Restore a Session on a Cold Start (no stored session id) |
| `POST /api/auth/otp/space/resend` | Resend an OTP Code |

#### Custom Credential Sign-In (NEW generated apps only)

Email OTP remains the default. When a new app explicitly requires its own
password or other credential, verify that credential inside a registered
Server Function and follow the `server-functions` integration's credential-hook
contract. Never implement credential verification in the browser.

The browser call must be a root-relative, same-origin `POST` and must include
`credentials: 'include'`. The hook must return an explicit failure for rejected
credentials and, after genuine server-side verification, a stable subject plus
email in its JSON success response. Treat that response only as app UI state.
The platform may separately establish a signed HttpOnly `hook_credential`
cookie that authorizes private WorkspaceDB identity for that workspace.
`hook_credential` is not OTP verification and does not grant founder,
delegation, mailroom, or other strict-email privileges.

Until a reviewed binding exists for that exact hook version — and by default
none does — a hook success creates NO platform session. Never treat a stored
"signed in" record that carries no platform session id as signed in: the
platform reads that browser as an anonymous visitor, so the person's private
rows stay invisible and every private write is refused with
`SESSION_VERIFICATION_REQUIRED`. Clear such a record and send the person back
through platform OTP.

A response shape alone is not authority: hook names, hook metadata, caller
headers, and `_meta.success` cannot activate this path. The platform-owned,
reviewed binding pins the workspace, immutable hook ID, exact code hash/version,
`POST` method, success predicate, and identity extractors. Changing the hook
source stops recognition until that exact version is reviewed again. If no
reviewed binding exists, use platform OTP rather than assuming the hook response
created a WorkspaceDB identity.

Never set `verified`, `sessionVerified`, `canonicalSessionId`,
`workspaceSessionId`, or `X-Session-Id` in page JavaScript for custom
credential auth. The cookie is HttpOnly; the WorkspaceDB transport sends it
without exposing it to the page. A paired, reviewed `POST` logout hook should
revoke that grant; clearing UI state alone is not server-side logout.

Existing deployed apps do not need to adopt this contract, change hooks, or
republish. Their recognition is handled separately by platform-owned fleet
review.

```typescript
async function signInWithCustomCredential(
  configId: string | number,
  hookName: string,
  credential: { email: string; password: string },
) {
  const response = await fetch(
    `/api/hooks/execute/workspace-${configId}/${encodeURIComponent(hookName)}`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credential),
    },
  );
  const result = await response.json();
  if (!response.ok || result.success !== true) {
    throw new Error(result.error || 'Sign-in failed');
  }

  // App UI state only. Do not manufacture platform verification/session fields.
  return result;
}
```

Signing out is a PLATFORM call: the space session cookie is HttpOnly, so
page code cannot clear it. `POST /api/space/{spaceId}/logout` (or
`/space/{spaceId}/logout` when the page is served on the shared space path)
expires the cookie and invalidates the session server-side; clearing
`localStorage` alone leaves the next person on a shared browser signed in.

```typescript
/*
 * NEW generated apps only: custom credentials use a reviewed registered POST
 * hook called by same-origin fetch with credentials: 'include'.
 * A response shape alone is not authority; platform-owned exact-version
 * recognition may set a scoped HttpOnly WorkspaceDB cookie.
 * Never set verified, sessionVerified, canonicalSessionId, workspaceSessionId,
 * or X-Session-Id in page JavaScript for custom credential auth.
 * Existing deployed apps do not need to adopt this contract.
 */
// Email OTP remains supported alongside optional workspace-configured Google
// Sign-In for published app end users. The stock EmailGate owns Google provider
// rendering; do not hardcode provider buttons or OAuth callback URLs here.
const registrationResponse = await fetch(`/api/space/${spaceId}/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email }),
});
const registration = await registrationResponse.json();
if (
  !registrationResponse.ok ||
  !registration.workspaceId ||
  !registration.provisionalSessionToken ||
  registration.workspaceSessionId !== null
) {
  throw new Error(registration.error || 'Registration failed');
}

const { workspaceId, provisionalSessionToken } = registration;
const binding = {
  email,
  workspaceId,
  spaceId,
  sessionUuid: provisionalSessionToken,
};

const sendResponse = await fetch('/api/auth/otp/space/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(binding),
});
const sendData = await sendResponse.json();
if (sendResponse.status === 429) {
  throw new Error(`Try again in ${sendData.retryAfter} seconds`);
}
if (!sendResponse.ok) throw new Error(sendData.error || 'Failed to send code');

const verifyResponse = await fetch('/api/auth/otp/space/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ...binding, code }),
});
const data = await verifyResponse.json();
if (
  !verifyResponse.ok ||
  data.success !== true ||
  data.sessionVerified !== true ||
  typeof data.canonicalSessionId !== 'string'
) {
  throw new Error(data.error || 'Verification failed');
}

const canonicalSessionId = data.canonicalSessionId;
const workspaceSessionId = data.workspaceSessionId;
const sessionKey = `space_session_${spaceId}`;
try {
  localStorage.setItem(sessionKey, JSON.stringify({
    id: canonicalSessionId,
    workspaceSessionId: canonicalSessionId,
    workspaceId,
    email,
    verified: true,
    timestamp: Date.now(),
  }));
} catch {
  // Verification still succeeded; keep the canonical ID in memory.
}

async function lookupSpaceSession(
  workspaceId: string,
  workspaceSessionId: string,
) {
  const query = new URLSearchParams({
    workspaceId,
    sessionUuid: workspaceSessionId,
  });
  const response = await fetch(`/api/auth/otp/space/check-session?${query}`);
  if (!response.ok) throw new Error('Session lookup failed');
  return response.json();
}

async function logoutSpaceSession(spaceId: string) {
  // The platform session cookie is HttpOnly, so page code cannot clear it.
  // POST the platform logout FIRST: it expires the cookie and invalidates the
  // session server-side, so a replayed cookie no longer signs the visitor in.
  try {
    const sharedSpacePath = `/space/${encodeURIComponent(spaceId)}`;
    const logoutUrl = window.location.pathname === sharedSpacePath
      ? `${sharedSpacePath}/logout`
      : `/api/space/${encodeURIComponent(spaceId)}/logout`;
    await fetch(logoutUrl, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });
  } catch {}
  try {
    localStorage.removeItem(`space_session_${spaceId}`);
  } catch {}
}
```

---

### slack
**Category:** Communication & Collaboration
Post messages, manage channels, and track VA tasks through Slack.

| Endpoint | Purpose |
|----------|--------|
| `GET /api/slack/channels?workspaceId=...` | List Channels |
| `POST /api/slack/messages` | Post Message |
| `POST /api/slack/tasks` | Create VA Task |
| `GET /api/slack/tasks?workspaceId=...&status=pending` | List Tasks |
| `PATCH /api/slack/tasks/:taskId` | Update Task Status |

```
GET /api/slack/channels?workspaceId=...
```

---

### social-publishing
**Category:** Marketing / Social Media
Connect and publish to the workspace's social accounts — LinkedIn organization

| Endpoint | Purpose |
|----------|--------|
| `POST /api/workspaces/:workspaceId/marketing/posts/linkedin` | Publish to LinkedIn |
| `POST /api/workspaces/:workspaceId/marketing/posts/video` | Publish a Video to Instagram |
| `POST /api/workspaces/:workspaceId/marketing/connect/linkedin/init` | LinkedIn |
| `GET /api/workspaces/:workspaceId/marketing/connect/linkedin/status` |  |
| `GET /api/workspaces/:workspaceId/marketing/connect/linkedin/organizations` |  |
| `POST /api/workspaces/:workspaceId/marketing/connect/linkedin/select-organization` |  |

```tsx
// Publish a text post to the workspace's connected LinkedIn page.
const ws = (window as any).__workspaceDb;
const base = `/api/workspaces/${ws.workspaceId}/marketing`;

const result = await fetch(`${base}/posts/linkedin`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': ws.token },
  body: JSON.stringify({ text: 'Hello from our app!' }),
}).then((r) => r.json());
```

---

### space-chat
**Category:** Conversations
Read, list, rename, and delete the conversation history between your customers and the space's AI assistant.

| Endpoint | Purpose |
|----------|--------|
| `GET /api/space/{spaceId}/chat/threads` | List conversations |
| `GET /api/space/{spaceId}/chat/history` | Read one conversation's messages |
| `POST /api/space/{spaceId}/chat/stream` | Create a conversation / send a message (optional `toolScope` narrows the tools sent to the model for that turn) |
| `PATCH /api/space/{spaceId}/chat/threads/{threadId}` | Rename a conversation |
| `DELETE /api/space/{spaceId}/chat/threads/{threadId}` | Delete a conversation |

The template runtime also forwards an optional `agent.toolScope` array from
the baked, file, or public space config on every stream turn (including an
automatic greeting). It is a narrowing hint only: omitted, empty, or
unknown-only scopes preserve the server's existing full-toolset behavior; the
browser never invents tool names.

```tsx
const spaceId = window.__SPACE_ID__; // e.g. "workspace-12345"

// The canonical session is stored only after successful OTP verification.
// Never use a provisional token or invent your own storage key.
function getWorkspaceSessionId(spaceId: string): string | null {
  try {
    const stored = localStorage.getItem(`space_session_${spaceId}`);
    if (!stored) return null;
    const session = JSON.parse(stored);
    if (session.verified !== true) return null;
    const id = session.workspaceSessionId;
    return typeof id === 'string' && id.startsWith('wses_') ? id : null;
  } catch {
    return null;
  }
}

const sessionId = getWorkspaceSessionId(spaceId);
if (!sessionId) return; // Not signed in yet — there is nothing to read or change.

// 1. List the visitor's conversations — sessionId is a QUERY param.
const listRes = await fetch(
  `/api/space/${spaceId}/chat/threads?sessionId=${encodeURIComponent(sessionId)}`,
);
const { threads } = await listRes.json();

// 2. Rename one — sessionId and the "title" field go in the BODY.
await fetch(`/api/space/${spaceId}/chat/threads/${encodeURIComponent(threads[0].threadId)}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sessionId, title: 'Order status' }),
});

// 3. Delete one — sessionId is a QUERY param again. "main" can never be deleted.
const delRes = await fetch(
  `/api/space/${spaceId}/chat/threads/${encodeURIComponent('t_1739481000000')}` +
    `?sessionId=${encodeURIComponent(sessionId)}`,
  { method: 'DELETE' },
);
const { purgedMessages, fallbackThreadId } = await delRes.json();

// 4. Read a conversation's messages.
const histRes = await fetch(
  `/api/space/${spaceId}/chat/history?sessionId=${encodeURIComponent(sessionId)}` +
    `&threadId=main`,
);
const { messages, workspaceSessionId } = await histRes.json();
```

---

### space-platform-contract
**Category:** General
How a space participates in platform sessioning and how the in-space agent

```json
  "agent": { "welcomeMessage": "...", "greetingPrompt": "..." }
  ```

---

### stock-photos
**Category:** Media / Images
Search the Unsplash library for royalty-free, attribution-friendly photography. Use the URLs in `<img>` tags, as hero backgrounds, or as starting material for image-edit AI tools.

| Endpoint | Purpose |
|----------|--------|
| `GET /api/stock-photos?query=...&perPage=10&orientation=landscape` | Search Photos |

```
GET /api/stock-photos?query=...&perPage=10&orientation=landscape
```

---

### stripe-payments
**Category:** General
Accept payments in your Space through the workspace's active native provider. The `/api/payments/checkout`, `/api/payments/subscribe`, `/api/payments/status/:sessionId`, and stable `/buy/<paymentLinkId>` surfaces resolve the provider selected under Wallet → Accept Payments; app code must not hardcode Stripe. Paystack is available for Nigeria, Ghana, South Africa, Kenya, and Côte d'Ivoire with an encrypted `sk_test_…` or `sk_live_…` secret key and the exact workspace-specific webhook URL displayed in Wallet. Moyasar is available for Saudi Arabia/SAR one-time hosted invoices; connected credentials do not mean mada is verified live.

Subscription cancellations, renewals and plan changes can be delivered to a server function registered under the reserved name `subscription-events` (see `server-functions`), including cancellations made on the provider's hosted billing page and workspaces selling through the platform's merchant account. Moyasar is Saudi Arabia/SAR one-time-only: Wallet accepts only a secret key, registers the workspace-specific webhook, and reports mada verified live only after an API-re-fetched paid live transaction reports mada.

Flutterwave allows only ONE webhook address per Flutterwave account, so Audos receives every workspace's Flutterwave traffic at one shared address (`/api/payments/flutterwave/webhook`, printed in Wallet → Accept Payments) and attributes each delivery itself — checkout metadata, then an `audos_ws_<id>` marker in the payment reference, then the connected account when only one workspace could own it. One Flutterwave account can therefore serve several workspaces, and each workspace receives its own events by registering the reserved name `flutterwave-events` (see `server-functions`). No cross-workspace write is involved: each workspace's own function does its own writes.

| Endpoint | Purpose |
|----------|--------|
| `GET /api/crm/subscribers/:workspaceId` | List Subscribers (Metadata-Based) |
| `GET /api/crm/subscribers/:workspaceId?planTier=companion` |  |
| `GET /api/crm/subscribers/:workspaceId?planTier=companion,guide` |  |
| `GET /api/crm/subscribers/:workspaceId?status=active` |  |
| `GET /api/crm/subscribers/:workspaceId?planTier=guide&limit=50` |  |
| `POST /api/crm/subscribers/:workspaceId/backfill` | Backfill Existing Subscribers |
| `POST /api/payments/subscription/admin-cancel` | Server function cancels a workspace subscription after authenticating an app administrator |
| `POST /api/payments/subscription/cancel` | Customer cancels their own subscription (defaults to end of paid period) |
| `POST /api/payments/subscription/resume` | Customer undoes a scheduled cancellation |

> Both subscriber endpoints are workspace-authorized: call them from a server
> function with the sandbox `fetch` (the runner authenticates them for your
> workspace — there is no `platform.callAPI` helper) or as the workspace
> owner. Anonymous requests get `401`.

```typescript
// Uses defaults: 7-day trial, $5/mo
const { checkoutUrl } = await fetch('/api/payments/subscribe', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-App-Id': window.__APP_ID__ || window.__SPACE_ID__ },
  body: JSON.stringify({
    customerEmail: 'customer@example.com',
    successUrl: window.location.origin + '/welcome',
    cancelUrl: window.location.href
  })
}).then(r => r.json());

// Redirect to Stripe Checkout
window.location.href = checkoutUrl;
```

Administrator cancellation uses `POST /api/payments/subscription/admin-cancel`
from an enabled server function with
`{ subscriptionId, immediate?, actor: { email, id? }, requestId?, reason? }`.
Authenticate the app session and administrator role inside that function;
`actor` is audit data, not authorization. The runner signs workspace/function
scope. Direct browser calls and claimed roles do not authorize the endpoint.

For cancellation displays, inventory returns `cancel_at` (Unix seconds),
`cancel_at_iso`, and `cancellation_scheduled`. Native responses also expose
`cancelAt` (ISO) and `cancellationScheduled`. A date-only cancellation can
have a false raw `cancel_at_period_end`; preserve paid access until Stripe
reports termination, and suppress renewal notices for scheduled cancellations.
The per-customer `GET /api/space/:spaceId/subscription-status` read returns
the same `cancelAt` + `cancellationScheduled` fields next to its existing
`cancelAtPeriodEnd` / `currentPeriodEnd` — Customer-Portal cancellations show
up there as `cancellationScheduled: true` with `cancelAtPeriodEnd: false`, so
gate "cancels on …" banners on `cancellationScheduled`, never on the flag alone.

```typescript
// Customer-initiated cancel — requires the SAME verified space session the
// subscription-status read uses (body `sessionId`, `X-Session-Id`, or the
// signed space-session cookie). A caller-supplied email is never an identity.
const res = await fetch('/api/payments/subscription/cancel', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-App-Id': window.__APP_ID__ || window.__SPACE_ID__,
    'X-Session-Id': canonicalSessionId,
  },
  credentials: 'include',
  body: JSON.stringify({ subscriptionId }), // add `immediate: true` to stop now
}).then(r => r.json());

if (res.success) {
  // res.message already names the paid-through date; the next
  // /api/space/:spaceId/subscription-status call reflects it (no webhook wait).
  alert(res.message);
}
// POST /api/payments/subscription/resume (same body, no `immediate`) undoes it.
```

---

### task-scheduler
**Category:** Automation
Schedule recurring tasks and one-time automations scoped to a workspace.
Schedule management requires an authenticated principal: Otto, a task agent, or this workspace's own Server Function, whose calls to these routes the platform stamps automatically (no credential in function code, own workspace only). Browser-side app code is refused with `SCHEDULE_MANAGEMENT_UNAUTHENTICATED` (bare `X-Workspace-Id` header) or `SCHEDULE_MANAGEMENT_FORBIDDEN` (page credential) — have a Server Function do it. Caps: 100 active schedules per workspace, hourly is the fastest recurrence.

| Endpoint | Purpose |
|----------|--------|
| `POST /api/workspaces/:workspaceId/schedules` | Create a Recurring Schedule |
| `POST /api/workspaces/:workspaceId/schedules/email` | Schedule a One-Time Email |
| `GET /api/workspaces/:workspaceId/schedules` | List Schedules |
| `GET /api/workspaces/:workspaceId/schedules/:scheduleId` | Get a Schedule |
| `PATCH /api/workspaces/:workspaceId/schedules/:scheduleId` | Update a Schedule |
| `DELETE /api/workspaces/:workspaceId/schedules/:scheduleId` | Delete a Schedule |

```
POST /api/workspaces/:workspaceId/schedules
```

---

### video-clip
**Category:** Media / Video
Trim a source video to a single `[startSec, endSec]` segment server-side with ffmpeg and get back a permanent public MP4 URL on GCS. Use it to produce clean clips for the Raw-to-Post flow or social sharing without bundling ffmpeg.wasm in the browser or paying for a full Remotion render just to cut a video.

| Endpoint | Purpose |
|----------|--------|
| `POST /api/video/clip` | Trim a Clip |

```
POST /api/video/clip
```

---

### video-frames
**Category:** Media / Video
Pull still PNG frames out of any video URL at the timestamps you specify. Powered by ffmpeg server-side; returns public GCS URLs you can use as thumbnails, scrubber previews, or AI vision inputs.

| Endpoint | Purpose |
|----------|--------|
| `POST /api/video/frames` | Extract Frames |

```
POST /api/video/frames
```

---

### web-scraping
**Category:** Data & Search
Run ANY Apify actor to scrape Instagram, LinkedIn, Amazon, Twitter, YouTube, or any website.

```bash
# Search for actors by keyword (no API key required)
ts-node tools/apify-search-actors.ts "instagram scraper"
ts-node tools/apify-search-actors.ts "linkedin" 10
```

---

### web-search
**Category:** Data & Search
Search Google for real-time web results, news, images, shopping, and academic papers.

| Endpoint | Purpose |
|----------|--------|
| `POST /api/search` | API Endpoint |

```
POST /api/search
```

---

### workspace-community
**Category:** Social
Create shared, social experiences in your mini-apps with feeds, posts, reactions, real-time updates, and user presence (who's online). Perfect for leaderboards, team collaboration, and multiplayer features.

| Endpoint | Purpose |
|----------|--------|
| `POST /api/community/spaces` | API Endpoints |
| `GET /api/community/spaces?workspaceId=workspace-123` |  |
| `POST /api/community/spaces/:spaceId/posts` |  |
| `GET /api/community/spaces/:spaceId/posts?limit=50` |  |
| `POST /api/community/posts/:postId/reactions` |  |
| `POST /api/presence/spaces/:spaceId/join` | Presence API Endpoints |

```
POST /api/community/spaces
```

---

### workspace-db
**Category:** Data Persistence / Database
Store and query structured data in isolated PostgreSQL tables. Every workspace gets its own database schema. The SDK is auto-injected into Space apps — no imports needed.

| Endpoint | Purpose |
|----------|--------|
| `GET /api/workspaces/{workspaceId}/data/players?_shared=1&_select=id,username,color` |  |
| `GET /api/workspaces/{workspaceId}/db/tables` | List Tables |
| `GET /api/workspaces/{workspaceId}/db/tables/{tableName}?module={module}` | Describe Table |
| `GET /api/workspaces/{workspaceId}/data/{table}?_limit=50&_offset=0&_sort=created_at&_order=desc&status=eq.active` | Query Rows |
| `POST /api/workspaces/{workspaceId}/data/{table}` | Insert Rows |
| `PATCH /api/workspaces/{workspaceId}/data/{table}/{id}` | Update Row |

```tsx
function MyComponent() {
  const { data, loading, error, total, refresh } = useWorkspaceDB('orders', {
    filters: [
      { column: 'status', operator: 'eq', value: 'active' }
    ],
    orderBy: { column: 'created_at', direction: 'desc' },
    limit: 50,
    offset: 0,
    shared: false
  });

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return <ul>{data.map(row => <li key={row.id}>{row.name}</li>)}</ul>;
}
```

**A read result carries the rows and a total — and nothing that says the request succeeded.** There is no `success`, `ok`, or `status` field on it, so a success check such as `if (!result.success) throw ...` always fails on a read that worked. Branch on `loading` / `error` from the hook, or wrap the imperative client in `try`/`catch` — a failed read throws `WorkspaceDBError`, it never comes back as a falsy flag.

**Read through the injected client, not a hand-written address.** Use `useWorkspaceDB(...)` or `window.__workspaceDb.from(...)`. A `fetch` you compose yourself to a table URL can hit a path the data service does not publish (404), and it skips the `X-Workspace-DB-Token` and session headers the client sets for you.


---

## What Apps CANNOT Do

- **No direct database access** outside the WorkspaceDB SDK (`window.__workspaceDb` / `window.useWorkspaceDB`)
- **No server-side code execution** -- apps are client-side React components. Use `server-functions` for backend logic.
- **No direct access to API keys** -- all secrets are handled server-side via proxy endpoints
- **No file system access** -- use `file-storage` integration for persistent files
- **No direct Stripe/OpenAI/ElevenLabs API calls** -- always use the platform proxy endpoints listed above
- **No WebSocket servers** -- use `workspace-community` for real-time features
