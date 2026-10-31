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

## Deploy with GitHub and Vercel

The Vercel setup uses a Socket.IO WebSocket function and Redis for shared room state and message delivery. Rooms are saved in Redis for up to 24 hours. Keep `REDIS_URL` private; `.env*` files and `.vercel/` are ignored by Git.

1. Create an empty GitHub repository named `meme-machine`.
2. In a terminal opened in this folder, run `git init`, `git add .`, `git commit -m "Prepare Meme Machine for hosting"`, and `git branch -M main`.
3. Add your GitHub repository as `origin` with `git remote add origin https://github.com/YOUR-NAME/meme-machine.git`, then run `git push -u origin main`.
4. In Vercel, import that GitHub repository. Keep the project root as this folder. The included `vercel.json` sets `public` as the static output and configures the Socket.IO function.
5. In Vercel's Marketplace/Storage, add a Redis database (Upstash Redis works) and make its `REDIS_URL` available to Production, Preview, and Development deployments.
6. Confirm Fluid Compute is enabled for the project, then deploy. Vercel's WebSocket connections have a duration limit; the game reconnects and reloads room state from Redis when a connection closes.
7. Open the deployed URL on two devices, create a room, join by code, and finish a short match.

The WebSocket function is `/api/socket-io`; the health check is `/api/health`. For local play, Redis is optional and the app uses in-memory rooms. For Vercel, `REDIS_URL` is required.

## Phase 1 playtest

Use at least three phones if possible; four players gives a better test of the caption vote. Check room creation and joining, host start, selecting one of five captions, voting, scoring, the expanded Don't Copy Me categories, reconnecting after briefly turning Wi-Fi off, and host transfer after the host closes the tab. For a two-player check, confirm a bot caption appears in Caption rounds.

Without `REDIS_URL`, local room state is in memory and restarting the server clears active rooms. On Vercel, Redis keeps active rooms consistent across function instances and restarts.
