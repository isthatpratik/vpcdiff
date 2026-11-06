# vpcdiff site and viewer

Two pages, built by Vite: the landing page at `/` and the viewer at `/app/`. In the
viewer you open a Terraform plan in the browser and see which resources it makes
reachable from the internet, or no longer reachable. For each path, the viewer shows the hops before and after
the plan side by side, and the rule that decides each hop.

```sh
pnpm install
pnpm --filter @vpcdiff/viewer dev      # http://localhost:5173 (viewer at /app/)
pnpm --filter @vpcdiff/viewer build    # static site in apps/viewer/dist
```

## Privacy

The plan never leaves the device:

- The file is read with the File API and analyzed by the engine in a Web Worker.
- The built page has a Content Security Policy with `connect-src 'none'`, so the page
  and its worker cannot send any request. CI checks that the policy is in the build.
- No analytics, no cookies, no third party scripts. Fonts load from Google Fonts, the
  only other origin the policy allows (for styles and fonts, never for data). Example
  plans are synthetic fixtures bundled with the page.

## Stack

See [ADR 0005](../../docs/adr/0005-viewer-stack.md) and
[ADR 0006](../../docs/adr/0006-litt-components-and-landing-page.md): Vite, React, React
Flow, Tailwind CSS v4, litt.md components, Sora UI motion, and the Stageshow kit for the
hero demo. The visual rules are in [DESIGN.md](../../DESIGN.md).
