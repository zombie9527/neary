# Neary - Cloudflare Deployment Guide ☁️

Neary utilizes **Cloudflare Pages** and **Cloudflare KV** to provide a seamless, serverless P2P sharing experience. Follow these steps to deploy your own instance.

---

## 1. Prerequisites
- A **Cloudflare account**.
- **Wrangler CLI** installed and authenticated (`npx wrangler login`).

## 2. Setting up Cloudflare KV
Neary uses KV as a signaling relay for WebRTC. 
1. Open your Cloudflare Dashboard.
2. Go to **Workers & Pages** > **KV**.
3. Create a new namespace called `neary_kv`.
4. Copy the **ID** of the newly created namespace.

## 3. Configuring `wrangler.toml`
Ensure your `wrangler.toml` in the project root correctly points to your KV namespace:

```toml
name = "neary"
pages_build_output_dir = "dist"

[[kv_namespaces]]
binding = "KV"
id = "YOUR_KV_NAMESPACE_ID" # Paste the ID from Step 2 here
```

## 4. Deploying via Command Line
The easiest way to deploy is using the Wrangler CLI:

1. **Build the project**:
   ```bash
   npm run build
   ```
2. **Deploy to Cloudflare Pages**:
   ```bash
   npx wrangler pages deploy dist --project-name neary
   ```
   *Follow the prompts to create a new project if this is your first time.*

---

## 5. Web Dashboard Deployment (Alternative)
If you prefer using the Cloudflare Dashboard with GitHub:

1. **Create Project**: Go to **Workers & Pages** > **Create application** > **Pages** > **Connect to Git**.
2. **Build Settings**:
   - **Framework preset**: `Vite`
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
3. **Environment Variables**: No specific variables needed, but you **MUST** bind the KV namespace.
4. **KV Binding**:
   - After the first build, go to **Settings** > **Functions** > **KV namespace bindings**.
   - Add a binding: 
     - **Variable name**: `KV`
     - **KV namespace**: Select `neary_kv`.
   - **Redeploy** the project for changes to take effect.

---

## 6. Verification
Once deployed, Cloudflare will provide a URL (e.g., `https://neary.pages.dev`).
- Open the URL on two different devices.
- Enter the same 3-digit code.
- Check if the **Activity** icon turns green.

---

*Note: For production environments, ensure you specify a `compatibility_date` in your `wrangler.toml` or CLI command.*
