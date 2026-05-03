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
