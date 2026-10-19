# Masked Spire

A three-hero roguelike deckbuilder you play in the browser. Solo runs work on their own; 2-player online co-op runs on the server, with a duel between the two players after the final boss.

## How it works

- `public/index.html` is the game page (art, screens, input).
- `public/engine.js` holds all game rules and data. The page uses it for solo runs, and the server uses it to run co-op matches.
- `server.js` serves the page and runs every co-op match. Browsers send only the buttons and cards a player presses over a WebSocket at `/ws`; the server applies the rules and sends each player their own view.

Co-op matches live in the server's memory. A player who reloads or loses connection rejoins the same game automatically. Rooms with nobody connected are removed after 30 minutes (2 minutes once the game has ended).

## Deploy on Render

1. Push this folder to a GitHub repository.
2. On Render, choose **New → Blueprint**, pick the repository, and apply. `render.yaml` creates a free Node web service (`npm install`, then `npm start`).
   Or choose **New → Web Service**, pick the repo, and set Build Command `npm install`, Start Command `npm start`.
3. Open the `onrender.com` address Render gives you. Share that link with your co-op partner.

Free Render services go to sleep after about 15 minutes without visitors. The first visit afterwards takes up to a minute while it wakes, and any co-op games that were in progress are lost when it sleeps or redeploys. A paid instance stays awake.

## Run locally

```
npm install
npm start
```

Then open http://localhost:3000 in two browser windows to try co-op.

## Playing co-op

1. One player chooses **Host co-op** and gets a 5-letter room code.
2. The other opens the same site and enters the code under **Join with code** (or opens `/?room=CODE`).
3. Both pick a hero; the host starts the climb.
