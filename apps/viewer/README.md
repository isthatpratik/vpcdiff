# vpcdiff viewer

Open a Terraform plan in the browser and see which resources it makes reachable from the
internet, or no longer reachable. For each path, the viewer shows the hops before and after
the plan side by side, and the rule that decides each hop.

```sh
pnpm install
pnpm --filter @vpcdiff/viewer dev      # http://localhost:5173
pnpm --filter @vpcdiff/viewer build    # static site in apps/viewer/dist
```

## Privacy

The plan never leaves the device:

- The file is read with the File API and analyzed by the engine in a Web Worker.
- The built page has a Content Security Policy with `connect-src 'none'`, so the page
  and its worker cannot send any request. CI checks that the policy is in the build.
- No analytics, no external fonts or scripts. Example plans are synthetic fixtures
  bundled with the page.

## Stack

See [ADR 0005](../../docs/adr/0005-viewer-stack.md): Vite, React, React Flow, and a fixed
layout with one row per hop. Geist fonts are vendored under the SIL Open Font License
(`public/fonts-OFL.txt`). Icons are inlined from Phosphor (MIT).
