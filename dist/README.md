# dist/ — portal bundles

Generic iframe-safe zips for itch, CrazyGames Basic, and Poki.

- `./dist/make-portal-bundle.sh` → `dist/out/cut-the-fuse-portal.zip` (no SDK)
- `./dist/make-portal-bundle.sh --poki` → `dist/out/cut-the-fuse-poki.zip` (+ PokiSDK)

Each zip is self-contained: `index.html` + `src/` + `assets/` at root, relative
paths only, YouTube SDK stripped. Bundle scripts assert no `tools/`, `cert/`, or
`locked-branding/` leak in.
