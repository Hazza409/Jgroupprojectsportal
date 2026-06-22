# Putting the J Group dashboard on a server

Plain-English guide. ~30–45 minutes the first time. You'll use two free websites
(**GitHub** and **Render**) and one paid plan (~$7/month for the always-on server).

---

## What the pieces are

- **GitHub** — a website where your code lives online. Hosting services read your
  code from here to run it. It's also your off-site backup. Free.
- **Render** — the company that actually *runs* the app on a server, gives it a web
  address, and hosts the database. It reads your code from GitHub.
- **The database** — where all the data (projects, users, claims…) is stored.
- **The disk** — where uploaded files (photos, recon sheets, invoices, drawings,
  warranties) are saved. Render gives the app a permanent disk for these.

The included `render.yaml` tells Render to set up **all three** automatically.

---

## Step 1 — Put the code on GitHub

1. Create a free account at **https://github.com** (skip if you have one).
2. Click the **+** (top right) → **New repository**.
3. Name it `jgroup-dashboard`, choose **Private**, and **do NOT** tick "Add a
   README / .gitignore / license" (the project already has them). Click
   **Create repository**.
4. GitHub shows a URL like `https://github.com/yourname/jgroup-dashboard.git`.
   **Copy it** and send it to me — I'll push all the code up for you. (Or run, in
   the project folder: `git remote add origin <that-url>` then `git push -u origin main`.)

---

## Step 2 — Deploy on Render

1. Create a free account at **https://render.com** and connect your GitHub.
2. Click **New +** → **Blueprint**.
3. Pick your `jgroup-dashboard` repo. Render reads `render.yaml` and shows it will
   create a **web service**, a **Postgres database**, and a **disk**. Click **Apply**.
4. Wait ~5 minutes for the first build. When it's live, Render gives you a URL like
   `https://jgroup-dashboard.onrender.com`.

> Costs: the web service is the **Starter** plan (~$7/mo — needed so uploaded files
> persist). The database starts on the **free** plan (fine to trial; it expires
> after 90 days — upgrade it in the dashboard for real use). To stay fully free you
> can instead switch file storage to Cloudflare R2 (ask me) and drop the disk.

---

## Step 3 — Create the first login

The database starts empty. Create the starter accounts once:

1. In Render, open the **jgroup-dashboard** service → **Shell** tab.
2. Run: `npm run seed`
3. This creates the J Group builder login and demo client logins (it prints them).

You can then sign in at your Render URL and create your real jobs/clients from the
**Settings → Client Access** and **New job** screens.

---

## Environment variables (already handled by the blueprint)

| Variable | What it is | Set by |
|---|---|---|
| `DATABASE_URL` | Database connection | Render (auto) |
| `NEXTAUTH_SECRET` | Login security key | Render (auto-generated) |
| `NEXTAUTH_URL` | The app's web address | Auto (from Render's URL) |
| `STORAGE_DRIVER` / `LOCAL_STORAGE_DIR` | Uploaded-file storage → the disk | Blueprint |
| `EMAIL_DRIVER` | `console` (logs) → set to `resend` for real emails | You (optional) |
| `RESEND_API_KEY`, `EMAIL_FROM` | Email sending | You (optional) |
| `XERO_*` | Xero read-only sync | You (optional) |

To turn on **email notifications**: set `EMAIL_DRIVER=resend`, add a `RESEND_API_KEY`
(from resend.com) and `EMAIL_FROM`, then redeploy. To connect **Xero**: fill the
three `XERO_*` vars and set the redirect URI to `https://<your-url>/api/xero/callback`.

---

## Updating the app later

Any time the code changes and is pushed to GitHub, Render automatically rebuilds and
redeploys. Database schema changes are applied automatically on each deploy
(`prisma migrate deploy` runs at startup).

---

## Alternatives

- **Railway** — same idea as Render (managed Postgres + a disk volume); deploy from
  GitHub or its CLI. Use the same build (`npm install && npm run build`) and start
  (`npx prisma migrate deploy && npm run start`) commands.
- **Vercel + Neon + Cloudflare R2** — popular Next.js stack with generous free tiers,
  but serverless means file uploads **must** use R2/S3 (set `STORAGE_DRIVER=s3` + the
  `S3_*` vars). More services to wire up.
- **Your own VPS** — most control, most setup (Node + Postgres + Nginx + SSL +
  a process manager). Only if you need a dedicated box.
