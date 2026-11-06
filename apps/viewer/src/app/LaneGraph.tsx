import { Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import type { Path, Verdict } from "@vpcdiff/engine";
import { useMemo } from "react";
import { COLUMNS, type Cell, type Lanes } from "../graph.ts";
import { useResolvedTheme } from "../shared/theme.tsx";
import { DecisionTag, VERDICT_LABEL } from "./status.tsx";

// Hops are rows (read top to bottom, like the CLI); before and after are two columns.
const NODE_W = 232;
const NODE_H = 72;
const GAP_X = 32;
const GAP_Y = 16;
const LABEL_H = 44;
const LANE_X = { before: 0, after: NODE_W + GAP_X };

type HopData = { cell: Cell; label: string; changed: boolean; selected: boolean };
type LabelData = { title: string; verdict: Verdict };

function HopNode({ data }: NodeProps<Node<HopData>>) {
  const { cell, label, changed, selected } = data;
  const faded = cell.state === "not-reached" || cell.state === "absent";
  const ring = selected ? "ring-2 ring-litt-accent" : changed ? "ring-1 ring-litt-warning" : "";
  return (
    <div
      className={`grid h-[72px] w-[232px] cursor-pointer content-center justify-items-start gap-1 rounded-litt-surface border border-litt-line bg-litt-surface-1 px-3 transition-colors duration-200 hover:bg-litt-surface-2 ${ring} ${faded ? "opacity-50" : ""}`}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} className="!opacity-0" />
      <span className="text-litt-caption text-litt-fg-subtle">{label}</span>
      <span className="max-w-full truncate font-litt-mono text-litt-caption text-litt-fg" title={cell.resource}>
        {cell.resource || " "}
      </span>
      <DecisionTag state={cell.state} />
      <Handle type="source" position={Position.Bottom} isConnectable={false} className="!opacity-0" />
    </div>
  );
}

function LaneLabel({ data }: NodeProps<Node<LabelData>>) {
  return (
    <div className="grid w-[232px] gap-0.5">
      <span className="text-litt-small font-medium text-litt-fg">{data.title}</span>
      <span className="text-litt-caption text-litt-fg-subtle">{VERDICT_LABEL[data.verdict]}</span>
    </div>
  );
}

const nodeTypes = { hop: HopNode, lane: LaneLabel };

const edgeStroke = (next: Cell) => (next.state === "deny" ? "var(--litt-data-rose)" : next.state === "not-reached" || next.state === "absent" ? "var(--litt-line)" : "var(--litt-line-strong)");

export function LaneGraph({ path, lanes, selected, onSelect }: { path: Path; lanes: Lanes; selected: number; onSelect: (column: number) => void }) {
  const theme = useResolvedTheme();
  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    for (const side of ["before", "after"] as const) {
      const lane = lanes[side];
      nodes.push({ id: `${side}-label`, type: "lane", position: { x: LANE_X[side], y: 0 }, data: { title: side === "before" ? "Before" : "After", verdict: lane.outcome.verdict }, selectable: false });
      lane.cells.forEach((cell, i) => {
        const col = COLUMNS[i];
        const label = col?.key === "target" ? `Target ${path.protocol}/${path.ports}` : (col?.label ?? "");
        nodes.push({ id: `${side}-${i}`, type: "hop", position: { x: LANE_X[side], y: LABEL_H + i * (NODE_H + GAP_Y) }, data: { cell, label, changed: !!lanes.changed[i], selected: i === selected } });
        const next = lane.cells[i + 1];
        if (next) {
          const dashed = next.state === "not-reached" || next.state === "absent";
          edges.push({ id: `${side}-e${i}`, source: `${side}-${i}`, target: `${side}-${i + 1}`, style: { stroke: edgeStroke(next), strokeWidth: 1.5, strokeDasharray: dashed ? "4 4" : undefined } });
        }
      });
    }
    return { nodes, edges };
  }, [path, lanes, selected]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      colorMode={theme}
      fitView
      fitViewOptions={{ padding: 0.08, maxZoom: 1 }}
      minZoom={0.3}
      maxZoom={1.5}
      nodesDraggable={false}
      nodesConnectable={false}
      nodesFocusable={false}
      edgesFocusable={false}
      elementsSelectable={false}
      zoomOnScroll={false}
      panOnScroll
      onNodeClick={(_, node) => {
        const i = Number(node.id.split("-")[1]);
        if (Number.isInteger(i)) onSelect(i);
      }}
      aria-label={`Hops for ${path.to} ${path.protocol}/${path.ports}, before and after the plan. The same information is in the hop list beside it.`}
      style={{ background: "transparent" }}
    />
  );
}
