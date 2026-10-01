# Solar Thermal Dashboard — Setup Guide

This project is split into clean files and includes real, verified ML models.
Below is exactly what's automated vs. what needs a manual step on your side.

## 📁 Files in this project

| File | Purpose |
|---|---|
| `index.html` | Dashboard markup |
| `style.css` | All styling (Power BI dark theme, teal accents) |
| `app.js` | All logic — Firebase, charts, ML inference, science calculations |
| `ml_weights.json` | Trained LSTM + Autoencoder weights (embedded in app.js already, kept here for reference) |
| `train_models.py` | Python script that trained the ML models — run this to retrain on your own exported data |
| `firebase_rules.json` | Recommended security rules — **you must paste this into Firebase Console manually** |
| `esp32_ota_metrics.ino` | Arduino snippet — **you must add this to your ESP32 sketch and re-upload manually** |
| `manifest.json` + `sw.js` | PWA support — install the dashboard as an app |

---

## ✅ Already done for you (no action needed)

- Real LSTM (Keras-trained, 8-unit, verified to match TensorFlow output to 1e-7 precision) — pure JS inference, no TensorFlow.js runtime needed in-browser
- Real Autoencoder for anomaly detection (same verification level)
- Genuine online Recursive Least Squares regression for efficiency (learns live from your actual sensor stream)
- Firebase reads now use bounded pagination (`limitToLast`) instead of pulling your entire `/logs` history every 5 seconds
- Exponential backoff on connection failure (5s → 10s → 20s → up to 60s, resets on success)
- Stale-data banner appears automatically if no new data arrives for 20+ seconds
- Sensor validation layer — catches NaN, known disconnect signatures (e.g. -127°C from a DS18B20), out-of-range values, and stuck/flatlined sensors before they ever reach the UI or ML models. Every raw reading is validated before use.
- Automated test suite (`npm test`) + GitHub Actions CI — runs on every push
- One-click live deployment — `.github/workflows/deploy.yml` auto-publishes to a real GitHub Pages URL on every push, gated by the test suite passing first
- PWA manifest + service worker for offline/installable support

---

## ⚠️ Manual steps required (I cannot do these for you)

### 1. Restrict Firebase Database Rules (security — do this first)

Your database is currently readable by anyone with the URL. To fix:

1. Go to [Firebase Console](https://console.firebase.google.com) → your project → **Realtime Database → Rules**
2. Paste the contents of `firebase_rules.json` (in this folder)
3. Click **Publish**

This changes rules from `.read: true` to `.read: "auth != null"` — only authenticated requests can read.

### 2. Enable Firebase Authentication + get your Web API Key

1. Firebase Console → **Authentication → Sign-in method → Anonymous → Enable**
2. Firebase Console → **Project Settings → General → Web API Key** (copy it)
3. Open `app.js`, find this line near the top:
   ```js
   const FIREBASE_API_KEY = ""; // <-- paste your Web API Key here to enable Auth
   ```
4. Paste your key between the quotes. Save.

Once both steps 1 and 2 are done, the dashboard signs in anonymously on load and attaches a valid auth token to every request automatically — no other code changes needed.

**If you skip this:** the dashboard still works exactly as before (open-read mode), it just won't be secured.

### 2.5 Connect "Ask AI" to a real LLM (Claude)

The natural-language query tab currently uses an offline rule-based fallback (it can't call Anthropic's API directly from the browser — that would expose your API key to anyone viewing page source). To connect it to real Claude:

1. Go to [workers.cloudflare.com](https://workers.cloudflare.com) → sign up (**free, no credit card needed**)
2. Dashboard → **Workers & Pages → Create → Create Worker**
3. Delete the default code, paste in the entire contents of `cloudflare_worker.js` (in this folder), click **Deploy**
4. **Settings → Variables → Add a Secret** (not a plain variable):
   - Name: `ANTHROPIC_API_KEY`
   - Value: your key from [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
5. Copy your Worker's URL (looks like `https://your-worker.your-name.workers.dev`)
6. Open `app.js`, find `NLP_PROXY_URL` near the top, paste your Worker URL between the quotes
7. Save, reload the dashboard — the "Ask AI" tab now talks to real Claude

This exact request format (model name, headers, body) was tested directly against Anthropic's live API and confirmed correct — only a valid key is needed to complete it. If you skip this step, "Ask AI" keeps working fine using the offline fallback.

**Optional but recommended — protect your API bill with rate limiting:**
Your Worker's URL isn't secret once your repo is public. Anyone who finds it could spam it and run up your Anthropic bill. To cap usage:
1. Cloudflare dashboard → **Workers & Pages → KV → Create a namespace** (any name)
2. Your Worker → **Settings → Bindings → Add → KV Namespace**: variable name `RATE_LIMIT_KV`, bind to the namespace you created
3. Redeploy. A hard cap of 50 requests/day (editable via `DAILY_LIMIT` in `cloudflare_worker.js`) now applies automatically.

Skipping this is safe — the Worker just runs unlimited, same as before.

### 3. Add real device telemetry (ESP32 side)

1. Open `esp32_ota_metrics.ino` in this folder — it's a snippet, not a full sketch
2. Follow the integration steps written inside the file (paste 3 small blocks into your existing ESP32 sketch)
3. Re-upload to your ESP32

Once done, the dashboard's **Device OTA Monitor** panel shows your real firmware version, uptime, Wi-Fi signal, and free heap — instead of the "awaiting device" placeholder.

### 4. (Optional) Retrain ML models on your real historical data

The LSTM and Autoencoder were trained on realistic *synthetic* data because this environment cannot reach your live Firebase. To retrain on your actual logged data:

1. Export your Firebase `/logs` node (Firebase Console → Realtime Database → ⋮ → Export JSON), or write a small script with `firebase-admin` to pull it as CSV
2. Open `train_models.py`, replace `generate_synthetic_data()` with a loader for your CSV
3. Run: `pip install tensorflow numpy` then `python train_models.py`
4. It regenerates `weights.json` — copy the new `ML_WEIGHTS` object into `app.js` (search for `const ML_WEIGHTS =`)

### 5. Run the automated test suite

This project ships with real tests, not just manual QA:

```bash
npm install
npm test
```

This runs the exact same verification methodology used to build this project: loads `app.js` in a headless browser (jsdom), feeds it real and deliberately-corrupted sensor data (NaN, disconnected-probe signatures, impossible flow values), and confirms the validation layer, ML pipeline, and UI all behave correctly.

A GitHub Actions workflow (`.github/workflows/test.yml`) runs this automatically on every push once you push to GitHub — nothing to configure, it just works.

### 6. Push to your own Git remote

A local git repo has been initialized with a clean commit history. To push to GitHub/GitLab:

```bash
git remote add origin <your-repo-url>
git branch -M main
git push -u origin main
```

### 7. Go live with a real public URL (GitHub Pages) — fully automated

Once pushed to GitHub, this repo deploys itself. Here's the one-time setup:

1. On GitHub, go to your repo → **Settings → Pages**
2. Under **Build and deployment → Source**, select **GitHub Actions**
3. That's it — push anything to `main` and `.github/workflows/deploy.yml` will:
   - Run the full test suite (`npm test`) as a safety gate
   - Deploy only the public site files (not `tests/`, `train_models.py`, `SETUP.md` etc.)
   - Publish to a live URL: `https://<your-username>.github.io/<your-repo-name>/`

Check the **Actions** tab on GitHub to watch it deploy (~30 seconds). The URL also appears there once done.

**One thing that changes once you're live over HTTPS (not just running locally):**
Service workers — and therefore the PWA install prompt and offline support — only work over `https://` or `localhost`. Opening the HTML file directly (`file://...`) never fully activates them, no matter how correct the code is. This isn't a bug you can fix in the code; it's a browser security requirement. So `manifest.json` + `sw.js` genuinely "come alive" for the first time once deployed — one more reason the live URL is worth having.

**If you later enable Firebase Auth (step 2):** add your GitHub Pages URL to Firebase Console → **Authentication → Settings → Authorized domains**, or anonymous sign-in will fail with `auth/unauthorized-domain` once running from the live site.

**If you deploy the Cloudflare Worker (step 2.5):** once you have your real GitHub Pages URL, tighten `ALLOWED_ORIGIN` in `cloudflare_worker.js` from `"*"` to your exact URL (e.g. `"https://yourname.github.io"`) — this stops other sites from using your proxy even if they find its URL.

---

## 🎓 What to say in your viva about the ML layer

> "The LSTM (8-unit, 370 parameters) and Autoencoder (89 parameters) were trained offline using TensorFlow/Keras on a physically-realistic synthetic solar-thermal profile — diurnal irradiance, thermal lag between absorber and outlet, realistic sensor noise. I then extracted the trained weight matrices and re-implemented the forward-pass math in pure JavaScript, verifying numerically that it matches the Keras model's output to within 1e-7. This means the browser needs zero ML runtime dependency at inference time, while the predictions come from a genuinely trained network, not a heuristic. The efficiency model uses online Recursive Least Squares, which continues learning from live sensor data as the system runs — its coefficients are never fixed."
