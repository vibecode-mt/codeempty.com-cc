# CodeEmpty.com

Personal portfolio site with a built-in CMS. Hosted on Cloudflare Pages (free plan).

---

## Cloudflare Setup (one-time, do this before first deploy)

### 1. Create a Cloudflare account
Go to [cloudflare.com](https://cloudflare.com) and sign up for free.

### 2. Connect your domain
- In the Cloudflare dashboard, go to **Websites → Add a site** and enter `codeempty.com`.
- Follow the steps to update your domain's nameservers to Cloudflare's.

### 3. Create the D1 database
In the Cloudflare dashboard go to **Workers & Pages → D1** and click **Create database**.
- Name it: `codeempty-db`
- Note the **Database ID** shown after creation.
- Open `wrangler.toml` and replace `REPLACE_WITH_YOUR_D1_ID` with this ID.

### 4. Create the KV namespace
Go to **Workers & Pages → KV** and click **Create namespace**.
- Name it: `codeempty-pages-kv`
- Note the **Namespace ID**.
- Open `wrangler.toml` and replace both `REPLACE_WITH_YOUR_KV_ID` and `REPLACE_WITH_YOUR_KV_PREVIEW_ID` with this ID.

### 5. Create the R2 bucket (for image uploads)
Go to **R2 Object Storage** and click **Create bucket**.
- Name it: `codeempty-media`
- No other settings needed.

### 6. Connect GitHub to Cloudflare Pages
- Go to **Workers & Pages → Create → Pages → Connect to Git**.
- Select this GitHub repository.
- Set **Build command**: `npm run build`
- Set **Build output directory**: `dist`
- Click **Save and Deploy**.

### 7. Attach the D1, KV, and R2 bindings to Pages
After the Pages project is created:
- Go to your Pages project → **Settings → Functions**.
- Under **D1 database bindings**: add binding name `DB` → select `codeempty-db`.
- Under **KV namespace bindings**: add binding name `PAGES_KV` → select `codeempty-pages-kv`.
- Under **R2 bucket bindings**: add binding name `MEDIA` → select `codeempty-media`.
- Redeploy for the bindings to take effect.

### 8. Run the database migration
Install [Node.js](https://nodejs.org) and [Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/):
```
npm install
npx wrangler login
npm run db:migrate
```

### 9. Create your admin account
Visit `https://codeempty.com/admin/setup` — click **Create Admin Account** and **save the password shown**.

---

## Local Development

```bash
npm install

# Terminal 1 — build admin SPA in watch mode
npm run dev:admin

# Terminal 2 — start local Cloudflare Pages server
npm run db:migrate:local   # first time only
npm run dev
```

Open [http://localhost:8788](http://localhost:8788) for the site and [http://localhost:8788/admin](http://localhost:8788/admin) for the CMS.

---

## Deploying

Every push to the `main` branch automatically triggers a Cloudflare Pages build and deploy. You can also deploy manually:

```bash
npm run deploy
```

---

## Testing the Video-Based Project Workflow

This feature lets you build project steps by pausing a video and capturing frames, instead of entering content manually.

### Setup (local)

Run the new migration if you haven't already:
```bash
npm run db:migrate:local
```

### End-to-end test steps

**1. Create a project**
- Go to `/admin` → **Projects** → **+ New project**.
- Enter a title, click **Create Project**.
- You are redirected to the edit page. The **Video** section is now unlocked below the metadata form.

**2. Upload a video**
- In the **Video** section, drag a video file (MP4/MOV/WebM, any length) onto the upload area, or click to pick a file.
- A progress bar shows upload speed and ETA. The video is sent in 10 MB chunks.
- When complete, the video player appears.

**3. Capture frames to create steps**
- Use **▶ Play** / **⏸ Pause** (or press **Space**) to navigate the video.
- Drag the seek bar or use the timeline markers to jump to a specific moment.
- Press **📷 Capture Frame** (or press **F**) to freeze the current frame.
- A modal appears with a screenshot preview. Choose:
  - **New step** — enter a title; a new step is created at this timestamp.
  - **Existing step** — pick from the dropdown to add an element to an existing step.
- Select the **element type** (defaults to `image`). Add an optional caption.
- Click **Save**. The step/element is created and sorted by its video timestamp.

**4. Timeline view**
- The **Video Timeline** bar below the player shows all timestamped steps as orange markers.
- Click a marker to jump the video to that step's timestamp.
- Drag a marker left or right to adjust its timestamp (the step's sort order updates automatically).

**5. Time-Shift after video edits**
- Click **▼ Time-Shift** to expand the shift panel.
- Enter a **split point** (seconds) — everything at or after this point will shift.
- Enter an **offset** in seconds (positive = shift forward, negative = shift back).
- Click **Apply Shift**. All steps and content elements after the split point are updated in bulk.

**6. Replace a video**
- Click **Replace Video** at the top of the Video section.
- Upload the new file. Your existing steps and their timestamps are preserved.
- Use Time-Shift to re-align any steps that were displaced by the edit.

**7. Verify public rendering**
- Open the project's public URL (`/projects/[slug]`).
- Steps should appear in timestamp order, matching the order shown in the admin timeline.

### Manual steps (original workflow)
The original step-by-step manual workflow is unchanged. Use the **Add step** input and **+ Add content element** buttons at the bottom of the page as before. Manual steps (no video timestamp) always sort after video-timestamped steps.

---

## API Reference (OAuth)

External tools (e.g. AI via MCP) access the API using OAuth 2.0 client credentials.

**1. Get a token**
```
POST /api/oauth/token
Content-Type: application/json

{ "grant_type": "client_credentials", "client_id": "...", "client_secret": "..." }
```

**2. Use the token**
```
GET /api/projects
Authorization: Bearer <token>
```

Register apps and get credentials in the CMS at `/admin` → **API Apps**.
