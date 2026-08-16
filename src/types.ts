export type ElementType = "sticky" | "shape" | "text" | "drawing" | "image" | "connector" | "audio" | "stamp" | "math" | "table";

export type ShapeType =
  | "rect"
  | "circle"
  | "diamond"
  | "triangle"
  | "star"
  | "hexagon"
  | "pentagon"
  | "parallelogram"
  | "right-triangle"
  | "line"
  | "cartesian"
  | "numberline"
  | "advanced-cartesian";

export interface Point {
  x: number;
  y: number;
}

export interface ImageElement {
  id: string;
  type: "image";
  assetId?: string; // Reference to the private Supabase Storage asset record
  mimeType?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  src?: string; // Temporary local data URL before Storage upload
  reactions?: Record<string, string[]>; // emoji -> array of userNames
  zIndex: number;
  updatedAt?: number;
  updatedByClientId?: string;
  locked?: boolean;
}

export interface StickyElement {
  id: string;
  type: "sticky";
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color: string; // hex or tailwind class name
  textColor?: string;
  reactions?: Record<string, string[]>; // emoji -> array of userNames
  zIndex: number;
  updatedAt?: number;
  locked?: boolean;
}

export interface ShapeElement {
  id: string;
  type: "shape";
  shapeType: ShapeType;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color: string; // fill color
  borderColor: string;
  textColor?: string;
  reactions?: Record<string, string[]>; // emoji -> array of userNames
  zIndex: number;
  updatedAt?: number;

  graphPanX?: number;
  graphPanY?: number;

  // Cartesian plane specific advanced properties
  equation?: string; // e.g. "y = 2x + 1" or "x^2 - 2"
  equation2?: string; // second equation, e.g. "y = -x"
  equation3?: string; // third equation, e.g. "y = sin(x)"
  equationMin?: string;
  equationMax?: string;
  equations?: { id: string; expr: string; color: string; min?: string; max?: string }[];
  plottedPoints?: string; // comma-separated points, e.g., "(1,2), (-2,3)"
  plottedLines?: {
    id: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }[];
  cartesianRange?: number; // axis maximum scale (e.g., 5 or 10)
  axisFontSize?: number; // font size for axis labels
  cartesianGridMode?: 'cartesian' | 'polar' | 'isometric';
  cartesianPiTicks?: boolean;
  cartesianVariables?: { [name: string]: { min: number; max: number; step: number; val: number; isAnimating?: boolean } };
  cartesianTablePoints?: { x: number; y: number }[];
  cartesianTableRegression?: boolean;
  cartesianShowDerivative?: boolean;
  cartesianShowInspection?: boolean;
  cartesianInspectionX?: number;
  locked?: boolean;
}

export interface TextElement {
  id: string;
  type: "text";
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color: string; // text color
  fontSize: number;
  fontFamily?: "sans" | "serif" | "mono" | "handwritten" | "display";
  fontWeight?: "normal" | "bold";
  fontStyle?: "normal" | "italic";
  textDecoration?: "none" | "underline" | "line-through";
  textAlign?: "left" | "center" | "right";
  backgroundColor?: string; // background fill color
  borderColor?: string;
  borderStyle?: "none" | "solid" | "dashed";
  borderWidth?: number;
  reactions?: Record<string, string[]>; // emoji -> array of userNames
  zIndex: number;
  updatedAt?: number;
  locked?: boolean;
}

export interface MathElement {
  id: string;
  type: "math";
  x: number;
  y: number;
  width: number;
  height: number;
  text: string; // The LaTeX string
  color: string; // text/formula color
  fontSize: number;
  backgroundColor?: string; // background fill color
  borderColor?: string;
  borderStyle?: "none" | "solid" | "dashed";
  borderWidth?: number;
  reactions?: Record<string, string[]>; // emoji -> array of userNames
  zIndex: number;
  updatedAt?: number;
  locked?: boolean;
}

export interface DrawingElement {
  id: string;
  type: "drawing";
  points: Point[];
  color: string;
  width: number;
  isHighlighter: boolean;
  zIndex: number;
  updatedAt?: number;
  locked?: boolean;
}

export interface ConnectorElement {
  id: string;
  type: "connector";
  fromId: string;
  toId?: string; // If undefined, it connects to a free endPoint
  fromSocket: "top" | "right" | "bottom" | "left";
  toSocket?: "top" | "right" | "bottom" | "left";
  endPoint?: Point; // Used when dragging or connected to a free point
  color: string;
  strokeWidth?: number;
  lineStyle?: "straight" | "curved" | "elbow";
  label?: string;
  zIndex: number;
  updatedAt?: number;
}

export interface AudioElement {
  id: string;
  type: "audio";
  x: number;
  y: number;
  assetId?: string; // Reference to the private Supabase Storage asset record
  mimeType?: string;
  audioUrl?: string; // Temporary local audio data URL before Storage upload
  duration?: number; // Duration in seconds
  authorName?: string;
  color?: string;
  zIndex: number;
  updatedAt?: number;
  updatedByClientId?: string;
  locked?: boolean;
}

export interface StampElement {
  id: string;
  type: "stamp";
  x: number;
  y: number;
  width: number;
  height: number;
  stampType: "checked" | "star" | "great_job" | "needs_revision" | "grade_a" | "approved" | "signature" | "custom";
  label?: string;
  signatureAssetId?: string; // Reference to the private Supabase Storage asset record
  signatureDataUrl?: string; // Temporary local signature data URL before Storage upload
  assetId?: string;
  color?: string;
  stampShape?: "rounded-rect" | "circle" | "star" | "badge" | "diamond" | "banner" | "hexagon" | "ribbon" | "heart" | "shield" | "crest";
  zIndex: number;
  updatedAt?: number;
  updatedByClientId?: string;
  locked?: boolean;
}

export interface TableElement {
  id: string;
  type: "table";
  x: number;
  y: number;
  width: number;
  height: number;
  rows: number;
  cols: number;
  data: string[][]; // 2D array [row][col] of strings
  color?: string; // theme color
  headerBgColor?: string;
  cellBgColor?: string;
  borderColor?: string;
  textColor?: string;
  fontSize?: number;
  hasHeaderRow?: boolean;
  colWidths?: number[];
  reactions?: Record<string, string[]>;
  zIndex: number;
  updatedAt?: number;
  locked?: boolean;
}

export type BoardElement =
  | StickyElement
  | ShapeElement
  | TextElement
  | DrawingElement
  | ImageElement
  | ConnectorElement
  | AudioElement
  | StampElement
  | MathElement
  | TableElement;

export interface Collaborator {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  panX?: number;
  panY?: number;
  zoom?: number;
  viewCenterX?: number;
  viewCenterY?: number;
  role?: "student" | "teacher";
  lastActive: number;
}

export interface Whiteboard {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt?: number;
  createdBy: string;
  ownerUid?: string;
  accessMode?: "private" | "public" | "shared" | "link-view" | "link-edit";
  editorUids?: string[];
  viewerUids?: string[];
  status?: "initializing" | "ready";
  studentId?: string; // If assigned to a specific student
  studentName?: string;
  studentsCanWrite?: boolean;
  schemaVersion?: number;
  shardLayoutVersion?: number;
  shardCount?: number;
  currentRevision?: number;
  changedShardIds?: string[];
  deletedShardIds?: string[];
  totalElements?: number;
  effectivePermission?: "viewer" | "editor" | "owner" | "admin" | "none";
  effectiveCanWrite?: boolean;
  effectiveCanManage?: boolean;
  legacyLinkDisabled?: boolean;
}

export interface UserProfile {
  id: string;
  name: string;
  color: string;
  role?: "student" | "teacher";
  photoURL?: string;
  email?: string;
}
