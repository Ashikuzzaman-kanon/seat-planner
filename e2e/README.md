# Browser checks

Scripts that drive the running web app in Chrome (through `puppeteer-core`, so
no browser is downloaded — the installed Chrome is used) at laptop and phone
widths, and check what a person would see.

| Script | What it checks |
|---|---|
| `audit-ui.js` | Every page, and the pages linked from them, at both widths: no browser errors, nothing scrolls sideways, every icon-only button has hover text. Screenshots in `shots/`. |
| `dialogs.js` | Every dialog opens, fits on a phone, and closes. |
| `flow.js`, `flow2.js` | The booking flow from search to tickets. |
| `demo-ui.js` | Administration → Demo Data: populate, watch it run, read the result, delete. |
| `test-wake.js` | A sleeping API (simulated): the "Starting the server…" notice, one wake-up for many refused requests, staying signed in when it cannot be woken. |
| `test-phase2-ui.js`, `test-proxy.js` | The network screens; the web app's `/api` proxy. |
| `shoot.js` | Screenshots of chosen pages: `node shoot.js <label> /dashboard /dashboard/book`. |

## Running them

1. Start the API and the web app locally with the development data (README →
   Running it locally), including `npm run seed:unittestusers` — the checks
   sign in as `unittest-super1@example.com`.
2. Build and start the web app as it runs in production (`npm run build` then
   `npm start` in `frontend/`): some checks look at timing a dev server distorts.
3. Here: `npm install`, then `npm run all`, or any single script with `node`.

Settings, all optional (see `config.js`):

| Variable | Default |
|---|---|
| `E2E_WEB` | `http://localhost:3000` |
| `E2E_API` | `http://localhost:4000/api/v1` |
| `CHROME_PATH` | The usual Chrome location for Windows, macOS or Linux |

`demo-ui.js` steps aside if demo data is populated on purpose, and leaves the
database as it found it.
