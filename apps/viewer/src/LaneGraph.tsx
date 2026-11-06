import { Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import type { Path, Verdict } from "@vpcdiff/engine";
import { useMemo } from "react";
import { COLUMNS, type Cell, type Lanes } from "./graph.ts";

export const STATE_LABEL: Record<Cell["state"], string> = { allow: "Allows", partial: "Allows some", deny: "Denies", unknown: "Unknown", "not-reached": "Not reached", absent: "Absent" };
export const VERDICT_LABEL: Record<Verdict, string> = { allowed: "Reachable", blocked: "Blocked", unknown: "Unknown", absent: "Does not exist" };

// Hops are rows (read top to bottom, like the CLI); before and after are two columns.
const NODE_W = 232;
const NODE_H = 80;
const GAP_X = 32;
const GAP_Y = 24;
const LABEL_H = 48;
const LANE_X = { before: 0, after: NODE_W + GAP_X };

type HopData = { cell: Cell; label: string; changed: boolean; selected: boolean };
type LabelData = { title: string; verdict: Verdict };

function HopNode({ data }: NodeProps<Node<HopData>>) {
  const { cell, label, changed, selected } = data;
  const faded = cell.state === "not-reached" || cell.state === "absent";
  return (
    <div className={`hop-node${changed ? " is-changed" : ""}${selected ? " is-selected" : ""}${faded ? " is-faded" : ""}`}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <span className="caption-4 muted">{label}</span>
      <span className="resource caption-5" title={cell.resource}>
        {cell.resource || " "}
      </span>
      <span className={`badge caption-3 d-${cell.state}`}>{STATE_LABEL[cell.state]}</span>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}

function LaneLabel({ data }: NodeProps<Node<LabelData>>) {
  return (
    <div className="lane-label">
      <span className="title-4">{data.title}</span>
      <span className="caption-5 muted">{VERDICT_LABEL[data.verdict]}</span>
    </div>
  );
}

const nodeTypes = { hop: HopNode, lane: LaneLabel };

const edgeColor = (next: Cell) => (next.state === "deny" ? "var(--deny)" : next.state === "not-reached" || next.state === "absent" ? "var(--line)" : "var(--line-strong)");

export function LaneGraph({ path, lanes, selected, onSelect }: { path: Path; lanes: Lanes; selected: number; onSelect: (column: number) => void }) {
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
          const color = edgeColor(next);
          edges.push({ id: `${side}-e${i}`, source: `${side}-${i}`, target: `${side}-${i + 1}`, style: { stroke: color, strokeWidth: 1.5, strokeDasharray: next.state === "not-reached" || next.state === "absent" ? "4 4" : undefined } });
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
      aria-label={`Hops for ${path.to} ${path.protocol}/${path.ports}, before and after the plan. The same information is in the hop inspector below.`}
    />
  );
}
