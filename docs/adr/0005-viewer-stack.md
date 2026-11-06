# 0005: Viewer stack

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

The web viewer loads a Terraform plan in the browser, runs the engine, and shows the
reachability diff as a graph with a hop-by-hop inspector. Plan data must never leave
the device (AGENTS.md). The viewer has one screen and no server.

## Decision

- **Build:** Vite, static output, hosted on GitHub Pages.
- **UI:** React and React DOM.
- **Graph:** React Flow (`@xyflow/react`) for pan, zoom, nodes, and edges.
- **Layout:** our own column layout. Every path has the same hop order (internet,
  internet gateway, NACL, security groups, endpoint), so a fixed column per hop kind
  is readable and deterministic. No layout library.
- **Engine:** runs in a Web Worker, so a large plan does not freeze the page.
- **Privacy:** the plan is opened with the File API or drag and drop. A Content
  Security Policy with `connect-src 'none'` blocks every network request from the
  page. No analytics, no external fonts or scripts. Plan data never goes into the URL.
- **State:** React state and `useReducer`; no state library.

Runtime dependencies added by this ADR (viewer only): `react`, `react-dom`,
`@xyflow/react`. All MIT. The engine keeps zero runtime dependencies.

## Alternatives considered

- **Next.js:** its main features (server rendering, server components, API routes)
  do not apply to a client-only tool, and a server is a place where plan data could
  be sent. Static export works but disables some features and needs extra Pages setup.
- **ELK (`elkjs`) for layout:** strong layered layouts, but EPL-2.0 or GPL-3.0
  licensed, and not needed for a fixed hop order.
- **Cytoscape.js:** fast for very large graphs, but custom node content is harder.
- **D3 force layout:** nodes move, so paths are hard to read.
- **Svelte or Solid:** good options with smaller graph ecosystems.

## Consequences

- The viewer is a static site with no backend to run or secure.
- The column layout must be revisited if the engine adds paths with other hop orders
  (for example, peering or transit gateways).
- React Flow's styles and accessibility must be checked against the design rules.
