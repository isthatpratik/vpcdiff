"use client";
// @litt/icons 2026.10.26. What changed: https://littmd.vercel.app/changelog.md

/**
 * Icons: one solid set on one grid (litt.md components.md, Icons). 16 units, currentColor, so an icon takes the text
 * color it sits in. Each icon is a drawing of up to five parts, rendered by Icon:
 * - fill: the shape that encloses something, painted, its edge a 1-unit stroke with round joins, so it sits a quarter
 *   unit inside the outline's footprint.
 * - cut: its details, strokes at 1.5 with round caps, knocked out of the fill by a mask, never painted in a background
 *   color, so the icon works on any surface, glass included.
 * - hole: a shape knocked out of the fill whole, such as the gear's center.
 * - line: a mark that is only a line (a chevron, an arrow, a shackle, a ray), a 1.5 stroke with round caps and joins.
 * - dot: a fill-only mark beside the rest, such as the eye's pupil.
 * Shapes are drawn square and the round join is their only softening. Every icon fits the keylines (a circle of radius
 * 6.25, a square of 11.5, a landscape box of 12.5 by 9.5 or a portrait one of 9.5 by 12.5) and stays inside 1 to 15.
 * Arrows have 4.25 heads on their own and 3 inside a mark. Parts leave a stroke width of air between them.
 * Decorative unless labelled: an icon-only button names itself with aria-label.
 */
import { useId, type ReactNode, type SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & {
  /** Width and height in pixels. The drawing scales from its 16-unit grid and the strokes scale with it. */
  size?: number;
};

/** One icon's drawing: each part is a path's d. Subpaths that overlap must wind the same way, or the overlap is a hole. */
type Drawing = { fill?: string; cut?: string; hole?: string; line?: string; dot?: string };

const n = (v: number) => +v.toFixed(3);
/** A circle as a path, clockwise like rect, so circles and boxes in one part join where they overlap. */
const circle = (cx: number, cy: number, r: number) => `M${n(cx - r)} ${cy}a${r} ${r} 0 1 1 ${n(2 * r)} 0a${r} ${r} 0 1 1 ${n(-2 * r)} 0z`;
const rect = (x: number, y: number, w: number, h: number) => `M${x} ${y}h${w}v${h}h${-w}z`;

function Icon({ size = 16, draw = {}, children, ...rest }: IconProps & { draw?: Drawing; children?: ReactNode }) {
  const { fill, cut, hole, line, dot } = draw;
  const mask = useId().replace(/[^\w-]/g, "");
  const masked = Boolean(cut || hole);
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {masked && (
        <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="16" height="16">
          <rect width="16" height="16" fill="white" stroke="none" /* litt-allow: mask luminance, white keeps */ />
          {cut && <path d={cut} stroke="black" /* litt-allow: mask luminance, black cuts */ />}
          {hole && <path d={hole} fill="black" stroke="none" /* litt-allow: mask luminance, black cuts */ />}
        </mask>
      )}
      {fill && <path d={fill} fill="currentColor" strokeWidth={1} mask={masked ? `url(#${mask})` : undefined} />}
      {line && <path d={line} />}
      {dot && <path d={dot} fill="currentColor" stroke="none" />}
      {children}
    </svg>
  );
}

const DISC = circle(8, 8, 6.25);
const CHECK_CIRCLE: Drawing = { fill: DISC, cut: "m5.25 8.25 2 2 3.5-4.25" };
const X_CIRCLE: Drawing = { fill: DISC, cut: "m6 6 4 4m0-4-4 4" };
const EYE = "M1.75 8C3.25 5.25 5.4 3.75 8 3.75S12.75 5.25 14.25 8c-1.5 2.75-3.65 4.25-6.25 4.25S3.25 10.75 1.75 8z";
const LOCK = rect(3.25, 7.25, 9.5, 6.5);

/* Navigation: where you are and where you go. */
export const ChevronLeftIcon = (p: IconProps) => <Icon {...p} draw={{ line: "M10 3.5 5.5 8l4.5 4.5" }} />;
export const ChevronRightIcon = (p: IconProps) => <Icon {...p} draw={{ line: "m6 3.5 4.5 4.5L6 12.5" }} />;
export const ChevronUpIcon = (p: IconProps) => <Icon {...p} draw={{ line: "m3.5 10 4.5-4.5 4.5 4.5" }} />;
export const ChevronDownIcon = (p: IconProps) => <Icon {...p} draw={{ line: "m3.5 6 4.5 4.5L12.5 6" }} />;
export const ChevronsUpDownIcon = (p: IconProps) => <Icon {...p} draw={{ line: "m5 6.25 3-3 3 3M5 9.75l3 3 3-3" }} />;
export const ArrowLeftIcon = (p: IconProps) => <Icon {...p} draw={{ line: "M13 8H3M7.25 3.75 3 8l4.25 4.25" }} />;
export const ArrowRightIcon = (p: IconProps) => <Icon {...p} draw={{ line: "M3 8h10M8.75 3.75 13 8l-4.25 4.25" }} />;
export const ArrowUpIcon = (p: IconProps) => <Icon {...p} draw={{ line: "M8 13V3M3.75 7.25 8 3l4.25 4.25" }} />;
export const ArrowDownIcon = (p: IconProps) => <Icon {...p} draw={{ line: "M8 3v10M3.75 8.75 8 13l4.25-4.25" }} />;
export const ArrowUpRightIcon = (p: IconProps) => <Icon {...p} draw={{ line: "M4.5 11.5 11.5 4.5M5.5 4.5h6v6" }} />;
export const HomeIcon = (p: IconProps) => <Icon {...p} draw={{ fill: "M8 2.25 3.5 6.25v7.5h9v-7.5z", hole: rect(6.75, 10, 2.5, 5), line: "M2.25 7.25 8 2.25l5.75 5" }} />;
export const MenuIcon = (p: IconProps) => <Icon {...p} draw={{ line: "M2.5 4.5h11M2.5 8h11M2.5 11.5h11" }} />;
export const SidebarIcon = (p: IconProps) => <Icon {...p} draw={{ fill: rect(1.75, 3.25, 4.5, 9.5), line: "M6.25 3.5h7.75v9H6.25" }} />;
export const ExpandIcon = (p: IconProps) => <Icon {...p} draw={{ line: "M9.75 2.25h4v4M13.75 2.25l-4.5 4.5M6.25 13.75h-4v-4M2.25 13.75l4.5-4.5" }} />;
export const ShrinkIcon = (p: IconProps) => <Icon {...p} draw={{ line: "M13.75 2.25l-4.5 4.5M9.25 2.75v4h4M2.25 13.75l4.5-4.5M6.75 13.25v-4h-4" }} />;
export const UndoIcon = (p: IconProps) => <Icon {...p} draw={{ line: "M6 3.25 3 6.25l3 3M3 6.25h6.75a3.25 3.25 0 0 1 0 6.5H6" }} />;
export const RedoIcon = (p: IconProps) => <Icon {...p} draw={{ line: "m10 3.25 3 3-3 3M13 6.25H6.25a3.25 3.25 0 0 0 0 6.5H10" }} />;
export const RetryIcon = (p: IconProps) => <Icon {...p} draw={{ line: "M13.25 8a5.25 5.25 0 1 1-1.55-3.7M13.25 2.75v3h-3" }} />;
export const LogOutIcon = (p: IconProps) => <Icon {...p} draw={{ line: "M7 2.75H2.75v10.5H7M6 8h7.75M10.75 5l3 3-3 3" }} />;

/* Actions: what a control does. */
export const SearchIcon = (p: IconProps) => <Icon {...p} draw={{ line: circle(7, 7, 4.75) + "M10.5 10.5l3 3" }} />;
export const PlusIcon = (p: IconProps) => <Icon {...p} draw={{ line: "M8 3v10M3 8h10" }} />;
export const MinusIcon = (p: IconProps) => <Icon {...p} draw={{ line: "M3 8h10" }} />;
export const XIcon = (p: IconProps) => <Icon {...p} draw={{ line: "m4 4 8 8M12 4l-8 8" }} />;
export const CheckIcon = (p: IconProps) => <Icon {...p} draw={{ line: "m3.5 8.5 3 3 6-7" }} />;
export const EditIcon = (p: IconProps) => <Icon {...p} draw={{ fill: "M10.75 2.75a1.77 1.77 0 0 1 2.5 2.5L5.5 13H3v-2.5z", cut: "m9.5 4 2.5 2.5" }} />;
export const CopyIcon = (p: IconProps) => <Icon {...p} draw={{ fill: rect(5.25, 5.25, 7.5, 7.5), line: "M2.5 10.25V2.5h7.75" }} />;
export const LinkIcon = (p: IconProps) => <Icon {...p} draw={{ line: "m7 5.25 1.5-1.5a2.83 2.83 0 0 1 4 4L11 9.25M9 10.75l-1.5 1.5a2.83 2.83 0 0 1-4-4L5 6.75M6.25 9.75l3.5-3.5" }} />;
export const ShareIcon = (p: IconProps) => <Icon {...p} draw={{ line: "M8 9.75v-7.5M5 5.25l3-3 3 3M3.25 8.5v5h9.5v-5" }} />;
export const DownloadIcon = (p: IconProps) => <Icon {...p} draw={{ line: "M8 2.25V10M5 7l3 3 3-3M3.25 8.5v5h9.5v-5" }} />;
export const SendIcon = (p: IconProps) => <Icon {...p} draw={{ fill: "M13.75 2.25 9.5 13.75 7.25 8.75 2.25 6.5z", cut: "m13.75 2.25-6.5 6.5" }} />;
export const PaperclipIcon = (p: IconProps) => <Icon {...p} draw={{ line: "m13 7.25-5.3 5.3a3.25 3.25 0 0 1-4.6-4.6l5.65-5.65a2.1 2.1 0 0 1 3 3L6.1 10.95a1 1 0 0 1-1.4-1.4l5.05-5.05" }} />;
export const TrashIcon = (p: IconProps) => <Icon {...p} draw={{ fill: "M4.25 4.25l.6 9h6.3l.6-9z", cut: "M6.75 6.75v4M9.25 6.75v4", line: "M2.75 4.25h10.5M6.25 4.25V2.75h3.5v1.5" }} />;
export const ArchiveIcon = (p: IconProps) => <Icon {...p} draw={{ fill: rect(2.25, 2.75, 11.5, 3) + rect(3.25, 5.75, 9.5, 7.5), cut: "M1.5 6h13M6.5 9.25h3" }} />;
export const FilterIcon = (p: IconProps) => <Icon {...p} draw={{ fill: "M2.25 3.25h11.5L9.25 8.5v4.25l-2.5 1v-5.25z" }} />;
export const SortIcon = (p: IconProps) => <Icon {...p} draw={{ line: "M5 13V3M2 6l3-3 3 3M11 3v10M8 10l3 3 3-3" }} />;
export const SlidersIcon = (p: IconProps) => <Icon {...p} draw={{ fill: circle(11, 4.5, 1.5) + circle(5, 11.5, 1.5), line: "M2.5 4.5h11M2.5 11.5h11" }} />;
export const SettingsIcon = (p: IconProps) => <Icon {...p} draw={{ fill: "M6.43 3.68L6.59 1.91A6.25 6.25 0 0 1 9.41 1.91L9.57 3.68A4.6 4.6 0 0 1 10.96 4.48L12.57 3.74A6.25 6.25 0 0 1 13.98 6.17L12.53 7.2A4.6 4.6 0 0 1 12.53 8.8L13.98 9.83A6.25 6.25 0 0 1 12.57 12.26L10.96 11.52A4.6 4.6 0 0 1 9.57 12.32L9.41 14.09A6.25 6.25 0 0 1 6.59 14.09L6.43 12.32A4.6 4.6 0 0 1 5.04 11.52L3.43 12.26A6.25 6.25 0 0 1 2.02 9.83L3.47 8.8A4.6 4.6 0 0 1 3.47 7.2L2.02 6.17A6.25 6.25 0 0 1 3.43 3.74L5.04 4.48A4.6 4.6 0 0 1 6.43 3.68z", hole: circle(8, 8, 2.25) }} />;
export const MoreIcon = (p: IconProps) => <Icon {...p} draw={{ line: circle(3.5, 8, 0.75) + circle(8, 8, 0.75) + circle(12.5, 8, 0.75) }} />;
export const GripIcon = (p: IconProps) => <Icon {...p} draw={{ dot: [3.5, 8, 12.5].map((y) => circle(6, y, 1.25) + circle(10, y, 1.25)).join("") }} />;
export const EyeIcon = (p: IconProps) => <Icon {...p} draw={{ fill: EYE, hole: circle(8, 8, 2.75), dot: circle(8, 8, 1.5) }} />;
export const EyeOffIcon = (p: IconProps) => <Icon {...p} draw={{ fill: EYE, hole: circle(8, 8, 2.75), cut: "m3.8 1.7 10.5 10.5", line: "m2.75 2.75 10.5 10.5" }} />;
export const LockIcon = (p: IconProps) => <Icon {...p} draw={{ fill: LOCK, cut: "M8 9.75v1.5", line: "M5.25 7.25V5a2.75 2.75 0 0 1 5.5 0v2.25" }} />;
export const UnlockIcon = (p: IconProps) => <Icon {...p} draw={{ fill: LOCK, cut: "M8 9.75v1.5", line: "M5.25 7.25V5a2.75 2.75 0 0 1 5.35-.9" }} />;
export const StarIcon = (p: IconProps) => <Icon {...p} draw={{ fill: "M8 2.2 9.82 6.09 14.09 6.62 10.95 9.56 11.76 13.78 8 11.7 4.24 13.78 5.05 9.56 1.91 6.62 6.18 6.09z" }} />;
export const PinIcon = (p: IconProps) => <Icon {...p} draw={{ fill: "M10.25 3.73 7.57 6.42l-3.19.16-1.01 1.01 5.04 5.04 1.01-1.01.16-3.19 2.69-2.68z", line: "M5.89 10.11 2.87 13.13M9.42 2.89l3.69 3.69" }} />;

/* Objects: the things people make and keep. */
export const FileIcon = (p: IconProps) => <Icon {...p} draw={{ fill: "M4 1.75h5l3 3v9.5H4z", cut: "M9 1.75v3h3" }} />;
export const FolderIcon = (p: IconProps) => <Icon {...p} draw={{ fill: "M1.75 3.25h4.5l1.5 1.5h6.5v8H1.75z", cut: "M1.5 6.75h13" }} />;
export const ImageIcon = (p: IconProps) => <Icon {...p} draw={{ fill: rect(2.25, 2.75, 11.5, 10.5), hole: circle(5.75, 6.25, 1.25), cut: "m2.25 11.75 3.5-3.5 2.75 2.75 1.75-1.75 3.5 3.5" }} />;
export const PlayIcon = (p: IconProps) => <Icon {...p} draw={{ fill: "M5.25 3.25v9.5L12.75 8z" }} />;
export const PauseIcon = (p: IconProps) => <Icon {...p} draw={{ fill: rect(4.75, 3.25, 1.5, 9.5) + rect(9.75, 3.25, 1.5, 9.5) }} />;
export const StopIcon = (p: IconProps) => <Icon {...p} draw={{ fill: rect(4.25, 4.25, 7.5, 7.5) }} />;
export const CodeIcon = (p: IconProps) => <Icon {...p} draw={{ line: "M5.75 4 1.75 8l4 4M10.25 4l4 4-4 4" }} />;
export const TerminalIcon = (p: IconProps) => <Icon {...p} draw={{ line: "m2.75 4 4 4-4 4M8.75 12h4.5" }} />;
export const MonitorIcon = (p: IconProps) => <Icon {...p} draw={{ fill: rect(1.75, 2.75, 12.5, 8.5), line: "M8 11.25v2.5M5.5 13.75h5" }} />;
export const GlobeIcon = (p: IconProps) => <Icon {...p} draw={{ fill: DISC, cut: "M1.75 8h12.5M8 1.75a2.75 6.25 0 0 0 0 12.5 2.75 6.25 0 0 0 0-12.5z" }} />;
export const LayersIcon = (p: IconProps) => <Icon {...p} draw={{ fill: "M8 2.75 14 6 8 9.25 2 6z", line: "m2 10 6 3.25L14 10" }} />;
export const FrameIcon = (p: IconProps) => <Icon {...p} draw={{ line: "M4.25 1.75v12.5M11.75 1.75v12.5M1.75 4.25h12.5M1.75 11.75h12.5" }} />;
export const CursorIcon = (p: IconProps) => <Icon {...p} draw={{ fill: "M3 3 6.75 13.25l1.5-5 5-1.5z" }} />;
export const GridIcon = (p: IconProps) => <Icon {...p} draw={{ fill: rect(2.75, 2.75, 3.5, 3.5) + rect(9.75, 2.75, 3.5, 3.5) + rect(2.75, 9.75, 3.5, 3.5) + rect(9.75, 9.75, 3.5, 3.5) }} />;
export const ListIcon = (p: IconProps) => <Icon {...p} draw={{ line: "M6 4h7.5M6 8h7.5M6 12h7.5M2.75 4v.01M2.75 8v.01M2.75 12v.01" }} />;
export const BoxIcon = (p: IconProps) => <Icon {...p} draw={{ fill: "M8 2.25 13.25 5v6L8 13.75 2.75 11V5z", cut: "M2.75 5 8 7.75 13.25 5M8 7.75v6" }} />;
export const DatabaseIcon = (p: IconProps) => <Icon {...p} draw={{ fill: "M3 4a5 2 0 0 1 10 0v8c0 1.1-2.24 2-5 2s-5-.9-5-2z", cut: "M3 4c0 1.1 2.24 2 5 2s5-.9 5-2M3 8c0 1.1 2.24 2 5 2s5-.9 5-2" }} />;
export const GitBranchIcon = (p: IconProps) => <Icon {...p} draw={{ fill: circle(4.5, 3.75, 1.75) + circle(4.5, 12.25, 1.75) + circle(11.5, 3.75, 1.75), line: "M4.5 5.5v5M11.5 5.5v.75a3 3 0 0 1-3 3h-1a3 3 0 0 0-3 3" }} />;
export const CalendarIcon = (p: IconProps) => <Icon {...p} draw={{ fill: rect(2.25, 3.25, 11.5, 10.5), cut: "M1.5 6.75h13", line: "M5.5 1.75v3M10.5 1.75v3" }} />;

/* Status and system: always beside their words. */
export const InfoIcon = (p: IconProps) => <Icon {...p} draw={{ fill: DISC, cut: "M8 7.25v4M8 4.75v.01" }} />;
export const AlertIcon = (p: IconProps) => <Icon {...p} draw={{ fill: DISC, cut: "M8 4.75v4M8 11.25v.01" }} />;
export const CheckCircleIcon = (p: IconProps) => <Icon {...p} draw={CHECK_CIRCLE} />;
export const XCircleIcon = (p: IconProps) => <Icon {...p} draw={X_CIRCLE} />;
export const WarningIcon = (p: IconProps) => <Icon {...p} draw={{ fill: "M8 2 14.25 13.25H1.75z", cut: "M8 6.5v2.75M8 11.25v.01" }} />;
export const HelpIcon = (p: IconProps) => <Icon {...p} draw={{ fill: DISC, cut: "M6.25 6.25a1.75 1.75 0 1 1 2.5 1.6c-.45.2-.75.65-.75 1.15v.25M8 11.25v.01" }} />;
export const BellIcon = (p: IconProps) => <Icon {...p} draw={{ fill: "M4 11.25V7a4 4 0 0 1 8 0v4.25l1 1H3z", cut: "M1.5 13.3h13", dot: "M6.6 13.6h2.8a1.4 1.4 0 0 1-2.8 0z" }} />;
export const ClockIcon = (p: IconProps) => <Icon {...p} draw={{ fill: DISC, cut: "M8 4.75V8l2.25 1.5" }} />;
export const HistoryIcon = (p: IconProps) => <Icon {...p} draw={{ line: "M2.75 8a5.25 5.25 0 1 0 1.55-3.7M2.75 2.75v3h3M8 5.5V8l1.75 1.25" }} />;
export const ZapIcon = (p: IconProps) => <Icon {...p} draw={{ fill: "M9 1.75 3.25 9.25H8l-1 5 5.75-7.5H8z" }} />;
export const ActivityIcon = (p: IconProps) => <Icon {...p} draw={{ line: "M1.75 8h2.5l2-5.25 3.5 10.5 2-5.25h2.5" }} />;
export const ShieldIcon = (p: IconProps) => <Icon {...p} draw={{ fill: "M8 1.75 13 3.5v4.25c0 3-2.1 5-5 6.5-2.9-1.5-5-3.5-5-6.5V3.5z" }} />;
export const KeyIcon = (p: IconProps) => <Icon {...p} draw={{ fill: circle(5.25, 10.75, 3), hole: circle(5.25, 10.75, 1), line: "m7.4 8.6 6.1-6.1M11.5 4.5l1.75 1.75M9.75 6.25 11 7.5" }} />;
export const FlagIcon = (p: IconProps) => <Icon {...p} draw={{ fill: "M3.25 2.25h9.5l-2.25 3.25 2.25 3.25h-9.5z", line: "M3.25 14.25V2.25" }} />;
export const CloudIcon = (p: IconProps) => <Icon {...p} draw={{ fill: "M4.75 12.25A2.75 2.75 0 0 1 4.02 6.85A4 4 0 0 1 11.88 6.27A3 3 0 0 1 11.5 12.25z" }} />;
export const SunIcon = (p: IconProps) => <Icon {...p} draw={{ fill: circle(8, 8, 2.75), line: "M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.6 3.6l1 1M11.4 11.4l1 1M3.6 12.4l1-1M11.4 4.6l1-1" }} />;
export const MoonIcon = (p: IconProps) => <Icon {...p} draw={{ fill: "M13.25 9.4A5.5 5.5 0 0 1 6.6 2.75 5.5 5.5 0 1 0 13.25 9.4z" }} />;
export const SparkleIcon = (p: IconProps) => <Icon {...p} draw={{ fill: "M8 1.75c.5 3.4 2.85 5.75 6.25 6.25-3.4.5-5.75 2.85-6.25 6.25-.5-3.4-2.85-5.75-6.25-6.25C5.15 7.5 7.5 5.15 8 1.75z" }} />;
export const LightbulbIcon = (p: IconProps) => <Icon {...p} draw={{ fill: "M6 10.75v-.35c0-.9-.45-1.4-1-2A4 4 0 1 1 11 8.4c-.55.6-1 1.1-1 2v.35z", line: "M6.5 13.5h3" }} />;

/* People and data. */
export const UserIcon = (p: IconProps) => <Icon {...p} draw={{ fill: circle(8, 5.5, 2.75) + "M2.75 13.75c.8-2.4 2.9-3.75 5.25-3.75s4.45 1.35 5.25 3.75z", cut: circle(8, 5.5, 4.4) }} />;
export const UsersIcon = (p: IconProps) => <Icon {...p} draw={{ fill: circle(6, 5.5, 2.5) + "M1.75 13.25c.65-2.1 2.2-3.25 4.25-3.25s3.6 1.15 4.25 3.25z" + circle(10.25, 5.5, 2.5) + "M10.5 10c2 0 3.35 1.15 3.75 3.25H11z", cut: circle(6, 5.5, 3.75) + "M6 8.75c2.4 0 4.6 1.4 5.4 4.25l.3 1.25" }} />;
export const BuildingIcon = (p: IconProps) => <Icon {...p} draw={{ fill: rect(3.25, 1.75, 9.5, 12.5), hole: rect(6.75, 10.25, 2.5, 5), cut: "M6.25 4.5v.01M9.75 4.5v.01M6.25 8v.01M9.75 8v.01", line: "M1.75 14.25h12.5" }} />;
export const MailIcon = (p: IconProps) => <Icon {...p} draw={{ fill: rect(1.75, 3.25, 12.5, 9.5), cut: "m2.25 4.25 5.75 4.5 5.75-4.5" }} />;
export const InboxIcon = (p: IconProps) => <Icon {...p} draw={{ fill: "M1.75 8.25v4.5h12.5v-4.5L12 3.25H4z", cut: "M1.75 8.25h3.5l1 1.75h3.5l1-1.75h3.5" }} />;
export const MessageIcon = (p: IconProps) => <Icon {...p} draw={{ fill: "M1.75 2.75h12.5v8.5H6.5l-3 2.5v-2.5H1.75z" }} />;
export const AtSignIcon = (p: IconProps) => <Icon {...p} draw={{ line: circle(8, 8, 2.5) + "M10.5 5.5v3.25a1.75 1.75 0 0 0 3.5 0V8a6 6 0 1 0-2.35 4.77" }} />;
export const HashIcon = (p: IconProps) => <Icon {...p} draw={{ line: "M6.75 2.75 5.25 13.25M10.75 2.75l-1.5 10.5M2.75 6h10.5M2.75 10h10.5" }} />;
export const CommandIcon = (p: IconProps) => <Icon {...p} draw={{ line: "M9.75 4.75v6.5a1.75 1.75 0 1 0 1.75-1.75h-7a1.75 1.75 0 1 0 1.75 1.75v-6.5A1.75 1.75 0 1 0 4.5 6.5h7a1.75 1.75 0 1 0-1.75-1.75z" }} />;
export const ChartBarIcon = (p: IconProps) => <Icon {...p} draw={{ fill: rect(2.75, 8.75, 1.5, 4.5) + rect(7.25, 2.75, 1.5, 10.5) + rect(11.75, 6.25, 1.5, 7) }} />;
export const ChartLineIcon = (p: IconProps) => <Icon {...p} draw={{ line: "M2.25 2.25v11.5h11.5M5 10.25 7.75 7l2.5 2 3.5-4.5" }} />;
export const ChartPieIcon = (p: IconProps) => <Icon {...p} draw={{ fill: "M7 3.75a5.25 5.25 0 1 0 5.25 5.25H7zM9.5 1.75a4.75 4.75 0 0 1 4.75 4.75H9.5z" }} />;
export const TrendUpIcon = (p: IconProps) => <Icon {...p} draw={{ line: "m1.75 11.5 4.5-4.5 2.5 2.5 5.5-5.5M10.5 4h3.75v3.75" }} />;
export const TrendDownIcon = (p: IconProps) => <Icon {...p} draw={{ line: "m1.75 4.5 4.5 4.5 2.5-2.5 5.5 5.5M10.5 12h3.75V8.25" }} />;
export const CreditCardIcon = (p: IconProps) => <Icon {...p} draw={{ fill: rect(1.75, 3.25, 12.5, 9.5), cut: "M1 6.5h14M4.5 9.75h2" }} />;
export const BagIcon = (p: IconProps) => <Icon {...p} draw={{ fill: rect(3.25, 5.25, 9.5, 9), line: "M5.75 5.25V4a2.25 2.25 0 0 1 4.5 0v1.25" }} />;

/** Where a step, a tool call or a task stands. The Timeline draws the same five marks. */
export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";

/**
 * The status mark for steps and tool calls: an empty ring (pending), a ring half filled (running, never spinning or
 * pulsing), a dashed ring (skipped), and a filled disc with the check (done) or the x (failed) cut out. It takes the
 * text color, so the caller sets the tone (--litt-fg for running, --litt-fg-muted for done, --litt-danger for failed, --litt-fg-subtle for
 * pending and skipped). Decorative: say the status in words beside it.
 */
export function StatusIcon({ status, ...p }: IconProps & { status: StepStatus }) {
  if (status === "done") return <Icon {...p} draw={CHECK_CIRCLE} />;
  if (status === "failed") return <Icon {...p} draw={X_CIRCLE} />;
  const skipped = status === "skipped";
  return (
    <Icon {...p}>
      <circle cx="8" cy="8" r="6.25" strokeDasharray={skipped ? "2.45" : undefined} strokeLinecap={skipped ? "butt" : undefined} />
      {status === "running" && <path d="M8 1.75a6.25 6.25 0 0 1 0 12.5z" fill="currentColor" />}
    </Icon>
  );
}
