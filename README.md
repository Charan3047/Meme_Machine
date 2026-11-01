# Meme Machine

Meme Machine is a mobile-friendly party game for 2–8 players. In Caption rounds, everyone picks one of five funny responses to the same prompt, then votes for the funniest submitted response. Don't Copy Me rounds use a secret machine pick and themed tiles, now drawn from 32 categories. The caption prompt deck contains 47 scenarios. One person hosts a room and shares its four-letter code or same-Wi-Fi invite address.

## Run locally

1. Install the current Node.js LTS release.
2. Open this folder in VS Code.
3. In the VS Code terminal, run `npm install` once.
4. Run `npm start` and leave the terminal open.
5. Open `http://localhost:3000` on the host's computer.
6. For friends on the same Wi-Fi, use the `Same-Wi-Fi invite` address printed in the terminal. If Windows asks about the firewall, allow Node.js on private networks.

The service check is at `http://localhost:3000/api/health` and should return `{"ok":true,"game":"meme-machine"}`.

## Deploy on GitHub and Vercel

The Vercel deployment uses a Socket.IO WebSocket function plus Redis for room state and cross-instance messages. Room records expire after 24 hours. `.env*`, `.vercel/`, and the separate `express-upstash/` tutorial sample are excluded from Git.

### Push the current project to GitHub

This folder is already connected to the `Charan3047/Meme_Machine` GitHub repository on the `main` branch. From the VS Code terminal opened in this folder:

1. Run `git status` and confirm the changed files are the Meme Machine project files.
2. Run `git add -A`.
3. Run `git commit -m "Prepare Meme Machine for Vercel"`.
4. Run `git push origin main`.

Do not add a second GitHub remote or run `git init` again. The `express-upstash/` folder is an unrelated tutorial sample and is ignored.

### Import and configure the Vercel project

1. In Vercel, choose **Add New → Project** and import the existing `Charan3047/Meme_Machine` repository.
2. Set the project root to the repository root. Use the **Other** framework preset if Vercel asks; do not select the nested `express-upstash/` sample.
3. Let Vercel use the included `vercel.json`: static files are in `public/`, with the real-time function at `api/socket-io.js` and the admin API at `api/admin.js`. The admin dashboard is the static page at `/admin/`. The default install command is `npm install`; there is no separate build command.
4. Create and connect an Upstash Redis database through Vercel's Marketplace/Storage.
5. Open the database's **Connect → TCP** section and copy its `rediss://default:...` connection string. In **Project Settings → Environment Variables**, add `REDIS_URL` with that entire value. Select Production, and Preview if you will test preview deployments. Do not paste the URL into a source file or commit it.
6. For the admin API, add `ADMIN_API_KEY` as another Vercel environment variable. Use a long, randomly generated secret and keep it private. The endpoint returns `503` until both `REDIS_URL` and `ADMIN_API_KEY` are configured.
7. Save the variables and deploy (or redeploy if the project was already deployed). WebSockets require Fluid Compute, which is enabled by default on new Vercel projects. This project sets the Socket.IO function's `maxDuration` to 300 seconds; Vercel closes a WebSocket when that duration ends, and the client reconnects and rejoins through Redis.
8. Check `https://YOUR-DEPLOYMENT/api/health`. It should return `{"ok":true,"game":"meme-machine"}`.
9. Open the deployed game on two devices. Create a room on one, join from the other, then play a short match. This checks both the WebSocket and the shared Redis room state.

The function route and Socket.IO endpoint are both `/api/socket-io`; the Socket.IO browser client is served as the static file `/socket.io.js`. The health route is `/api/health`. Local `npm start` uses in-memory rooms unless you set `REDIS_URL`; Vercel requires `REDIS_URL`.

## Admin API

Open `https://YOUR-DEPLOYMENT/admin/` for the private browser dashboard. Enter the `ADMIN_API_KEY` saved in Vercel; the dashboard keeps it in page memory only and clears it when you sign out or close the page. It includes live usage cards, recent game activity, and forms to add custom prompts and categories. The API endpoint is `https://YOUR-DEPLOYMENT/api/admin`; requests use the bearer token header (`Authorization: Bearer YOUR_ADMIN_API_KEY`). Do not put the key in the public game code, a GitHub file, or a URL.

- `GET /api/admin?action=overview` reports active browser sessions seen in the last 60 seconds and totals for unique visitors, rooms, joins, matches, caption picks, votes, Don't Copy Me picks, and completed matches. Counts are aggregated; player names are not collected.
- `GET /api/admin?action=content` lists prompts and categories added by admins.
- `POST /api/admin?action=add-prompt` adds a caption setup. JSON body: `{"question":"...","botCaption":"...","captions":["...","...","...","...","..."]}`.
- `POST /api/admin?action=add-category` adds a Don't Copy Me category. JSON body: `{"category":"Pets","options":[{"name":"Dog","emoji":"🐶","weight":5},{"name":"Cat","emoji":"🐱","weight":5}]}`. Include 2–12 options; weights from 1–5 are optional.

Example PowerShell usage (replace the deployment address and key locally):

```powershell
$headers = @{ Authorization = "Bearer YOUR_ADMIN_API_KEY" }
Invoke-RestMethod "https://YOUR-DEPLOYMENT/api/admin?action=overview" -Headers $headers

$prompt = @{
  question = "When the group chat picks a movie"
  botCaption = "We watched the trailers until sunrise"
  captions = @("The snacks got more screen time", "We picked a movie by committee", "I fell asleep during the opening logos", "The remote is the real main character", "We will finish choosing by next weekend")
} | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method Post -Uri "https://YOUR-DEPLOYMENT/api/admin?action=add-prompt" -Headers $headers -ContentType "application/json" -Body $prompt
```

New content is saved in Redis and loaded into newly started matches. Existing matches keep the content they started with.

After joining or creating a room, its code is added to the URL history. Browser Back returns to the home screen and leaves the room; Forward rejoins it while the room is still active.

## Multiplayer playtest checklist

Use at least three phones if possible; four players gives a better test of the caption vote. Check room creation and joining, host start, selecting one of five captions, voting, scoring, the expanded Don't Copy Me categories, reconnecting after briefly turning Wi-Fi off, and host transfer after the host closes the tab. For a two-player check, confirm a bot caption appears in Caption rounds.

Without `REDIS_URL`, local room state is in memory and restarting the server clears active rooms. On Vercel, Redis keeps active rooms consistent across function instances and connection reconnects.
