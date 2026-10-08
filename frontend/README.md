# Frontend development

Use Node.js 26 or newer, then run:

```sh
npm ci
npm start
```

Vite serves the app on port 3000 (or `PORT` if set). `BROWSER=none` disables
opening the browser. `npm run build` writes the production site to `build/`;
`npm run preview` serves that build locally. `npm test` runs the component tests
with Vitest and jsdom; `npm run test:watch` starts watch mode.

The existing `REACT_APP_*` public configuration names are retained. Source reads
these through `import.meta.env`, and Vite loads frontend `.env` files or shell
environment variables. These values are public browser settings, never secrets.
For local API access, set `REACT_APP_API_BASE_URL` and
`REACT_APP_EVAL_API_BASE_URL` to the corresponding backend addresses, as before.

Development includes `/dev`, `/eval`, `/discover`, and `/deploy`. Production
builds exclude these tools through the `virtual:dev-routes` module; set
`REACT_APP_DEV_TOOLS=true` to explicitly include them in a local production
build. Docker excludes their source folders and verifies they are absent from
the bundle. Google login, reCAPTCHA, and LLM URLs retain the existing Docker
runtime placeholder injection and Compose environment settings.

Files containing JSX use `.jsx`; ordinary JavaScript helpers keep `.js`.
