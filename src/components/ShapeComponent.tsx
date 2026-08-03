import React, { useState, useRef, useEffect, useMemo } from "react";
import { ShapeElement, UserProfile, ShapeType } from "../types";
import {
  Smile,
  Trash2,
  TrendingUp,
  Plus,
  X,
  Layers,
  Lock,
  Unlock,
  Sliders,
  Play,
  Pause,
  Table,
  Compass,
  Activity,
  Eye,
  RefreshCw,
  Sparkles,
  SlidersHorizontal,
  HelpCircle,
  Grid,
  Zap,
} from "lucide-react";

/**
 * Safely parses and evaluates algebraic mathematical functions like f(x) = y
 * with variable substitution, trig, and safe evaluation.
 */
function evaluateMathExpression(
  expr: string,
  xVal: number,
  vars: Record<string, { val: number }> = {}
): number | null {
  try {
    let clean = expr.trim().toLowerCase();
    if (clean.startsWith("y=")) clean = clean.substring(2);
    else if (clean.startsWith("y =")) clean = clean.substring(3);
    else if (clean.startsWith("f(x)=")) clean = clean.substring(5);
    else if (clean.startsWith("f(x) =")) clean = clean.substring(6);

    clean = clean.trim();
    if (!clean) return null;

    if (clean.startsWith("x=") || clean.startsWith("x =")) {
      return null; // Handled separately as a vertical line
    }

    // Substitute dynamic variable values (a, b, c, m, k, etc.)
    if (vars) {
      Object.keys(vars).forEach((vName) => {
        const valObj = vars[vName];
        if (valObj && typeof valObj.val === "number") {
          const regex = new RegExp(`\\b(${vName})\\b`, "g");
          clean = clean.replace(regex, `(${valObj.val})`);
        }
      });
    }

    // Replace algebraic 'x' with actual numeric value inside parenthesis
    let formula = clean.replace(/\b(x)\b/g, `(${xVal})`);

    // Replace exponents ^ with JS operator **
    formula = formula.replace(/\^/g, "**");

    // Add implicit multiplication, e.g. "2(" -> "2*(", "2x" -> "2*x"
    formula = formula.replace(/(\d|\))\s*\(|(\d)\s*([a-z])|([a-z])\s*(\d)/gi, (m, p1, p2, p3, p4, p5) => {
      if (p1) return `${p1}*(`;
      if (p2 && p3) return `${p2}*${p3}`;
      if (p4 && p5) return `${p4}*${p5}`;
      return m;
    });

    // Support key common math functions & constants
    formula = formula.replace(/\basin\b/g, "Math.asin");
    formula = formula.replace(/\bacos\b/g, "Math.acos");
    formula = formula.replace(/\batan\b/g, "Math.atan");
    formula = formula.replace(/\bsin\b/g, "Math.sin");
    formula = formula.replace(/\bcos\b/g, "Math.cos");
    formula = formula.replace(/\btan\b/g, "Math.tan");
    formula = formula.replace(/\babs\b/g, "Math.abs");
    formula = formula.replace(/\bsqrt\b/g, "Math.sqrt");
    formula = formula.replace(/\blog\b/g, "Math.log10");
    formula = formula.replace(/\bln\b/g, "Math.log");
    formula = formula.replace(/\bpi\b/g, "Math.PI");
    formula = formula.replace(/\be\b/g, "Math.E");

    // Strictly validate expression elements to prevent XSS or malicious execution
    const sanitizedFormula = formula.replace(
      /[^0-9+\-*/().\s*Math\.sincostanabsasinacosatanloglnsqrtPIE]/g,
      ""
    );

    const result = new Function(`return (${sanitizedFormula})`)();
    if (typeof result === "number" && !isNaN(result) && isFinite(result)) {
      return result;
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Parses inequalities like y <= 2x + 1 or y > sin(x)
 */
function parseInequality(expr: string) {
  let clean = expr.trim().toLowerCase();
  if (clean.startsWith("f(x)")) clean = clean.substring(4).trim();

  let op: "<=" | "<" | ">=" | ">" | null = null;
  let subExpr = clean;

  if (clean.includes("<=")) {
    op = "<=";
    subExpr = clean.split("<=")[1] || "";
  } else if (clean.includes("\le")) {
    op = "<=";
    subExpr = clean.split("\le")[1] || "";
  } else if (clean.includes("<")) {
    op = "<";
    subExpr = clean.split("<")[1] || "";
  } else if (clean.includes(">=")) {
    op = ">=";
    subExpr = clean.split(">=")[1] || "";
  } else if (clean.includes("\ge")) {
    op = ">=";
    subExpr = clean.split("\ge")[1] || "";
  } else if (clean.includes(">")) {
    op = ">";
    subExpr = clean.split(">")[1] || "";
  }

  if (op) {
    if (subExpr.startsWith("y")) subExpr = subExpr.substring(1).trim();
    if (subExpr.startsWith("=")) subExpr = subExpr.substring(1).trim();
    const isStrict = op === "<" || op === ">";
    return { isInequality: true, op, isStrict, cleanExpr: subExpr.trim() };
  }

  return { isInequality: false, op: null, isStrict: false, cleanExpr: expr };
}

/**
 * Evaluates implicit 2D equations in x and y (e.g. x^2 + y^2 = 25 or x^2/9 + y^2/4 = 1)
 */
function evaluateImplicit2D(
  expr: string,
  xVal: number,
  yVal: number,
  vars: Record<string, { val: number }> = {}
): number | null {
  try {
    let clean = expr.trim().toLowerCase();
    if (!clean.includes("=")) return null;

    const parts = clean.split("=");
    if (parts.length !== 2) return null;

    let lhs = parts[0].trim();
    let rhs = parts[1].trim();

    // Substitute variables
    if (vars) {
      Object.keys(vars).forEach((vName) => {
        const valObj = vars[vName];
        if (valObj && typeof valObj.val === "number") {
          const regex = new RegExp(`\\b(${vName})\\b`, "g");
          lhs = lhs.replace(regex, `(${valObj.val})`);
          rhs = rhs.replace(regex, `(${valObj.val})`);
        }
      });
    }

    lhs = lhs.replace(/\b(x)\b/g, `(${xVal})`).replace(/\b(y)\b/g, `(${yVal})`);
    rhs = rhs.replace(/\b(x)\b/g, `(${xVal})`).replace(/\b(y)\b/g, `(${yVal})`);

    lhs = lhs.replace(/\^/g, "**").replace(/\bpi\b/g, "Math.PI").replace(/\bsin\b/g, "Math.sin").replace(/\bcos\b/g, "Math.cos");
    rhs = rhs.replace(/\^/g, "**").replace(/\bpi\b/g, "Math.PI").replace(/\bsin\b/g, "Math.sin").replace(/\bcos\b/g, "Math.cos");

    const sanitizedLhs = lhs.replace(/[^0-9+\-*/().\s*Math\.sincostanabsasinacosatanloglnsqrtPIE]/g, "");
    const sanitizedRhs = rhs.replace(/[^0-9+\-*/().\s*Math\.sincostanabsasinacosatanloglnsqrtPIE]/g, "");

    const valLhs = new Function(`return (${sanitizedLhs})`)();
    const valRhs = new Function(`return (${sanitizedRhs})`)();

    if (typeof valLhs === "number" && typeof valRhs === "number" && !isNaN(valLhs) && !isNaN(valRhs)) {
      return valLhs - valRhs;
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Contour Marching Squares generator for implicit relations (conics, circles, ellipses, hyperbolas)
 */
function generateImplicitContourPath(
  expr: string,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  cx: number,
  cy: number,
  scaleX: number,
  scaleY: number,
  vars: Record<string, { val: number }> = {}
): string {
  const stepsX = 60;
  const stepsY = 60;
  const dx = (maxX - minX) / stepsX;
  const dy = (maxY - minY) / stepsY;

  const grid: (number | null)[][] = [];
  for (let i = 0; i <= stepsX; i++) {
    grid[i] = [];
    const x = minX + i * dx;
    for (let j = 0; j <= stepsY; j++) {
      const y = minY + j * dy;
      grid[i][j] = evaluateImplicit2D(expr, x, y, vars);
    }
  }

  let pathStr = "";
  for (let i = 0; i < stepsX; i++) {
    for (let j = 0; j < stepsY; j++) {
      const v0 = grid[i][j];
      const v1 = grid[i + 1][j];
      const v2 = grid[i + 1][j + 1];
      const v3 = grid[i][j + 1];

      if (v0 === null || v1 === null || v2 === null || v3 === null) continue;

      const x0 = minX + i * dx;
      const x1 = x0 + dx;
      const y0 = minY + j * dy;
      const y1 = y0 + dy;

      const edges: { x: number; y: number }[] = [];

      if ((v0 >= 0 && v1 < 0) || (v0 < 0 && v1 >= 0)) {
        const t = Math.abs(v0) / (Math.abs(v0) + Math.abs(v1) || 1e-6);
        edges.push({ x: x0 + t * dx, y: y0 });
      }
      if ((v1 >= 0 && v2 < 0) || (v1 < 0 && v2 >= 0)) {
        const t = Math.abs(v1) / (Math.abs(v1) + Math.abs(v2) || 1e-6);
        edges.push({ x: x1, y: y0 + t * dy });
      }
      if ((v2 >= 0 && v3 < 0) || (v2 < 0 && v3 >= 0)) {
        const t = Math.abs(v2) / (Math.abs(v2) + Math.abs(v3) || 1e-6);
        edges.push({ x: x1 - t * dx, y: y1 });
      }
      if ((v3 >= 0 && v0 < 0) || (v3 < 0 && v0 >= 0)) {
        const t = Math.abs(v3) / (Math.abs(v3) + Math.abs(v0) || 1e-6);
        edges.push({ x: x0, y: y1 - t * dy });
      }

      if (edges.length >= 2) {
        const px1 = cx + edges[0].x * scaleX;
        const py1 = cy - edges[0].y * scaleY;
        const px2 = cx + edges[1].x * scaleX;
        const py2 = cy - edges[1].y * scaleY;
        pathStr += `M ${px1} ${py1} L ${px2} ${py2} `;
      }
    }
  }

  return pathStr;
}

/**
 * Scans equation expressions to extract dynamic single-letter variables (e.g. a, b, c, m, k)
 */
function extractEquationVariables(equations: string[]): string[] {
  const reserved = new Set([
    "x", "y", "e", "pi", "sin", "cos", "tan", "asin", "acos", "atan",
    "sinh", "cosh", "tanh", "log", "ln", "exp", "sqrt", "abs", "min",
    "max", "floor", "ceil", "round", "sign", "rad", "deg"
  ]);

  const detected = new Set<string>();

  equations.forEach((expr) => {
    if (!expr) return;
    const tokens = expr.match(/\b[a-zA-Z]+\b/g) || [];
    tokens.forEach((token: string) => {
      const lower = token.toLowerCase();
      if (!reserved.has(lower) && lower.length === 1) {
        detected.add(lower);
      }
    });
  });

  return Array.from(detected);
}

function renderMathText(str: string): React.ReactNode {
  if (!str) return null;

  const regex = /\^(\(([^)]+)\)|\{([^}]+)\}|([+-]?[0-9a-zA-Z.]+))/;
  const match = str.match(regex);

  if (!match) {
    return <span key={str}>{formatTerm(str)}</span>;
  }

  const index = match.index!;
  const before = str.substring(0, index);
  const matchedText = match[0];
  const exponentContent = match[2] || match[3] || match[4] || "";
  const after = str.substring(index + matchedText.length);

  return (
    <React.Fragment key={str}>
      {before && renderMathText(before)}
      <sup className="relative -top-1 text-[75%] font-semibold ml-0.5 mr-0.5 text-indigo-600 font-sans select-all">
        {renderMathText(exponentContent)}
      </sup>
      {after && renderMathText(after)}
    </React.Fragment>
  );
}

function formatTerm(term: string): React.ReactNode[] {
  const tokenRegex = /(sin|cos|tan|log|ln|sqrt|csc|sec|cot|sinh|cosh|tanh|abs|exp|f\(x\)|g\(x\)|π|[a-zA-Z]|[0-9.]+|[^a-zA-Z0-9.\s]+|\s+)/gi;
  const tokens = term.match(tokenRegex) || [term];

  const functions = new Set(["sin", "cos", "tan", "log", "ln", "sqrt", "csc", "sec", "cot", "sinh", "cosh", "tanh", "abs", "exp"]);
  const operatorsWithSpace = new Set(["+", "-", "=", "·", "≤", "≥", "≠", "<", ">"]);

  return tokens.map((token, i) => {
    const trimmed = token.trim();
    if (!trimmed) {
      return <span key={i}> </span>;
    }

    const lower = trimmed.toLowerCase();

    if (functions.has(lower)) {
      return (
        <span key={i} className="font-sans not-italic font-bold text-slate-700/90 mx-0.5">
          {trimmed}
        </span>
      );
    }

    if (lower === "f(x)" || lower === "g(x)") {
      const fnName = trimmed[0];
      return (
        <span key={i} className="font-serif">
          <span className="italic font-bold text-slate-900">{fnName}</span>
          <span className="font-sans not-italic font-semibold text-slate-800">(x)</span>
        </span>
      );
    }

    if (trimmed === "π" || lower === "pi") {
      return (
        <span key={i} className="font-sans not-italic text-slate-900 mx-px">
          π
        </span>
      );
    }

    if (/^[a-zA-Z]$/.test(trimmed)) {
      return (
        <span key={i} className="font-serif italic font-bold text-indigo-950 mx-px">
          {trimmed}
        </span>
      );
    }

    if (/^[0-9.]+$/.test(trimmed)) {
      return (
        <span key={i} className="font-sans not-italic text-slate-800">
          {trimmed}
        </span>
      );
    }

    if (operatorsWithSpace.has(trimmed)) {
      return (
        <span key={i} className="font-sans not-italic text-slate-500/80 mx-1">
          {trimmed}
        </span>
      );
    }

    return (
      <span key={i} className="font-sans not-italic text-slate-600">
        {trimmed}
      </span>
    );
  });
}

/**
 * Formats mathematical expressions into Desmos-style clean math representation with superscripts & symbols
 */
function formatMathDisplay(expr: string): React.ReactNode {
  if (!expr || !expr.trim()) return null;

  let text = expr.trim();

  // Prepend y = if no explicit equality/inequality exists
  if (
    !text.toLowerCase().startsWith("y") &&
    !text.toLowerCase().startsWith("f(x)") &&
    !text.includes("=") &&
    !text.includes(">") &&
    !text.includes("<")
  ) {
    text = `y = ${text}`;
  }

  // Symbol replacement
  text = text
    .replace(/\*/g, " · ")
    .replace(/<=/g, " ≤ ")
    .replace(/>=/g, " ≥ ")
    .replace(/!=/g, " ≠ ")
    .replace(/\bpi\b/gi, "π")
    .replace(/\bsqrt\b/gi, "√");

  return (
    <div className="inline-flex items-center flex-wrap gap-y-0.5 text-slate-900 select-text">
      {renderMathText(text)}
    </div>
  );
}

/**
 * Calculates critical points: y-intercepts, roots (x-intercepts), extrema (peaks/troughs), intersections
 */
interface CriticalPointItem {
  x: number;
  y: number;
  type: "root" | "y-int" | "peak" | "trough" | "intersection";
  label: string;
  color: string;
}

function calculateCriticalPoints(
  equations: { expr: string; color: string; label: string }[],
  minX: number,
  maxX: number,
  vars: Record<string, { val: number }> = {}
): CriticalPointItem[] {
  const points: CriticalPointItem[] = [];

  equations.forEach((eq) => {
    if (!eq.expr) return;
    const ineq = parseInequality(eq.expr);
    if (ineq.cleanExpr.includes("=") && ineq.cleanExpr.includes("x") && ineq.cleanExpr.includes("y")) {
      return; // Skip implicit conics for root calculations
    }

    const exprToEval = ineq.cleanExpr;

    // y-intercept at x = 0
    if (minX <= 0 && maxX >= 0) {
      const y0 = evaluateMathExpression(exprToEval, 0, vars);
      if (y0 !== null && isFinite(y0)) {
        points.push({
          x: 0,
          y: y0,
          type: "y-int",
          label: `${eq.label} y-int`,
          color: "#3b82f6",
        });
      }
    }

    // Roots & Extrema via sampling
    const steps = 120;
    const dx = (maxX - minX) / steps;
    let prevY = evaluateMathExpression(exprToEval, minX, vars);

    for (let i = 1; i <= steps; i++) {
      const x1 = minX + (i - 1) * dx;
      const x2 = minX + i * dx;
      const y2 = evaluateMathExpression(exprToEval, x2, vars);

      if (prevY === null || y2 === null) {
        prevY = y2;
        continue;
      }

      // Root (x-intercept) detection
      if (prevY * y2 <= 0) {
        let a = x1, b = x2, rootX = (x1 + x2) / 2;
        for (let k = 0; k < 8; k++) {
          const mid = (a + b) / 2;
          const yMid = evaluateMathExpression(exprToEval, mid, vars);
          if (yMid === null) break;
          const yA = evaluateMathExpression(exprToEval, a, vars);
          if (yA !== null && yA * yMid <= 0) b = mid;
          else a = mid;
          rootX = mid;
        }
        points.push({
          x: rootX,
          y: 0,
          type: "root",
          label: `${eq.label} Zero`,
          color: "#10b981",
        });
      }

      // Local Extrema (peaks & troughs)
      if (i >= 2) {
        const x0 = minX + (i - 2) * dx;
        const y0 = evaluateMathExpression(exprToEval, x0, vars);
        if (y0 !== null) {
          const slope1 = (prevY - y0) / dx;
          const slope2 = (y2 - prevY) / dx;

          if (slope1 * slope2 < 0) {
            const isPeak = slope1 > 0 && slope2 < 0;
            points.push({
              x: x1,
              y: prevY,
              type: isPeak ? "peak" : "trough",
              label: `${eq.label} ${isPeak ? "Peak" : "Trough"}`,
              color: isPeak ? "#f59e0b" : "#8b5cf6",
            });
          }
        }
      }

      prevY = y2;
    }
  });

  // Intersections between equation pairs
  for (let i = 0; i < equations.length; i++) {
    for (let j = i + 1; j < equations.length; j++) {
      const eq1 = equations[i];
      const eq2 = equations[j];
      if (!eq1.expr || !eq2.expr) continue;

      const steps = 80;
      const dx = (maxX - minX) / steps;
      let prevDiff: number | null = null;

      for (let k = 0; k <= steps; k++) {
        const x = minX + k * dx;
        const yA = evaluateMathExpression(parseInequality(eq1.expr).cleanExpr, x, vars);
        const yB = evaluateMathExpression(parseInequality(eq2.expr).cleanExpr, x, vars);

        if (yA === null || yB === null) {
          prevDiff = null;
          continue;
        }

        const diff = yA - yB;
        if (prevDiff !== null && prevDiff * diff <= 0) {
          let a = x - dx, b = x, intX = x;
          for (let step = 0; step < 8; step++) {
            const mid = (a + b) / 2;
            const fA = evaluateMathExpression(parseInequality(eq1.expr).cleanExpr, mid, vars);
            const fB = evaluateMathExpression(parseInequality(eq2.expr).cleanExpr, mid, vars);
            if (fA === null || fB === null) break;
            const fDiff = fA - fB;
            if (fDiff * prevDiff <= 0) b = mid;
            else a = mid;
            intX = mid;
          }
          const finalY = evaluateMathExpression(parseInequality(eq1.expr).cleanExpr, intX, vars);
          if (finalY !== null) {
            points.push({
              x: intX,
              y: finalY,
              type: "intersection",
              label: `${eq1.label} ∩ ${eq2.label}`,
              color: "#ec4899",
            });
          }
        }
        prevDiff = diff;
      }
    }
  }

  return points;
}

/**
 * Computes linear regression y ~ mx + b for data tables
 */
function calculateLinearRegression(points: { x: number; y: number }[]) {
  if (points.length < 2) return null;
  const n = points.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, sumYY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumXX += p.x * p.x;
    sumYY += p.y * p.y;
  }

  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-9) return null;

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  const yMean = sumY / n;
  let ssTot = 0, ssRes = 0;
  for (const p of points) {
    const predY = slope * p.x + intercept;
    ssTot += (p.y - yMean) * (p.y - yMean);
    ssRes += (p.y - predY) * (p.y - predY);
  }

  const rSquared = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 1;

  return { slope, intercept, rSquared };
}

function formatPiFraction(val: number): string {
  const norm = val / Math.PI;
  if (Math.abs(norm) < 0.01) return "0";
  if (Math.abs(norm - 1) < 0.01) return "π";
  if (Math.abs(norm + 1) < 0.01) return "-π";
  if (Math.abs(norm - 2) < 0.01) return "2π";
  if (Math.abs(norm + 2) < 0.01) return "-2π";
  if (Math.abs(norm - 0.5) < 0.01) return "π/2";
  if (Math.abs(norm + 0.5) < 0.01) return "-π/2";
  if (Math.abs(norm - 1.5) < 0.01) return "3π/2";
  if (Math.abs(norm + 1.5) < 0.01) return "-3π/2";
  if (Math.abs(norm - 0.25) < 0.01) return "π/4";
  if (Math.abs(norm + 0.25) < 0.01) return "-π/4";
  return `${norm.toFixed(1)}π`;
}

function getVerticalLineConstant(expr: string): number | null {
  let clean = expr.trim().toLowerCase();
  if (clean.startsWith("x=")) {
    clean = clean.substring(2).trim();
  } else if (clean.startsWith("x =")) {
    clean = clean.substring(3).trim();
  } else {
    return null;
  }
  const val = parseFloat(clean);
  return isNaN(val) ? null : val;
}

interface ShapeComponentProps {
  element: ShapeElement;
  isSelected: boolean;
  currentUser: UserProfile;
  zoom: number;
  onSelect: (e: React.MouseEvent) => void;
  onUpdate: (updates: Partial<ShapeElement>) => void;
  onDelete: () => void;
  isDraggingOrResizing: boolean;
  activeTool?: string;
  canWrite?: boolean;
}

const EMOJIS = ["👍", "❤️", "🔥", "💡", "❓", "🎉"];

export default function ShapeComponent({
  element,
  isSelected,
  currentUser,
  zoom,
  onSelect,
  onUpdate,
  onDelete,
  isDraggingOrResizing,
  activeTool = "select",
  canWrite = true,
}: ShapeComponentProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [text, setText] = useState(element.text);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Cartesian Advanced States & Desmos Features
  const [showMathPanel, setShowMathPanel] = useState(false);
  const [equationInput, setEquationInput] = useState(element.equation || "");
  const [equationsArray, setEquationsArray] = useState(element.equations || []);
  const [pointsInput, setPointsInput] = useState("");
  const [rangeInput, setRangeInput] = useState(element.cartesianRange || 5);
  const [axisFontSize, setAxisFontSize] = useState(element.axisFontSize || 10);
  const [hoveredCoord, setHoveredCoord] = useState<{
    x: number;
    y: number;
  } | null>(null);

  // Desmos Feature States
  const [cartesianVariables, setCartesianVariables] = useState<
    Record<string, { min: number; max: number; step: number; val: number; isAnimating?: boolean }>
  >(element.cartesianVariables || {});

  const [customAddedVars, setCustomAddedVars] = useState<string[]>([]);

  const [tablePoints, setTablePoints] = useState<{ x: number; y: number }[]>(
    element.cartesianTablePoints || []
  );

  // Auto-detect dynamic equation variables (e.g. a, b, c, m, k)
  const detectedVarNames = useMemo(() => {
    const allExprs = [equationInput, ...equationsArray.map((e) => e.expr)];
    return extractEquationVariables(allExprs);
  }, [equationInput, equationsArray]);

  // Sync detected variables into cartesianVariables
  useEffect(() => {
    if (detectedVarNames.length === 0) return;
    let hasNew = false;
    const updated = { ...cartesianVariables };
    detectedVarNames.forEach((vName) => {
      if (!updated[vName]) {
        updated[vName] = { min: -10, max: 10, step: 0.1, val: 1 };
        hasNew = true;
      }
    });
    if (hasNew) {
      setCartesianVariables(updated);
      onUpdate({ cartesianVariables: updated });
    }
  }, [detectedVarNames]);

  // Active variable names list (detected from equations or manually added)
  const activeVarsList = useMemo(() => {
    const set = new Set([...detectedVarNames, ...customAddedVars]);
    if (element.cartesianVariables) {
      Object.keys(element.cartesianVariables).forEach((k) => set.add(k));
    }
    return Array.from(set);
  }, [detectedVarNames, customAddedVars, element.cartesianVariables]);

  const [showRegression, setShowRegression] = useState(
    element.cartesianTableRegression ?? false
  );

  const [gridMode, setGridMode] = useState<"cartesian" | "polar" | "isometric">(
    element.cartesianGridMode || "cartesian"
  );

  const [piTicks, setPiTicks] = useState(element.cartesianPiTicks ?? false);
  const [showDerivative, setShowDerivative] = useState(
    element.cartesianShowDerivative ?? false
  );

  const [desmosActiveTab, setDesmosActiveTab] = useState<"eq" | "sliders" | "table" | "grid" | "inspection">("eq");
  const [showInspection, setShowInspection] = useState(
    element.cartesianShowInspection ?? false
  );

  const [inspectionX, setInspectionX] = useState(
    element.cartesianInspectionX ?? 1
  );

  const [activeTab, setActiveTab] = useState<
    "equations" | "sliders" | "table" | "grid" | "inspection"
  >("equations");

  const [hoveredCritPoint, setHoveredCritPoint] = useState<CriticalPointItem | null>(null);

  // Smooth variable playback animation loop
  useEffect(() => {
    let animId: number;
    const hasAnimating = (Object.values(cartesianVariables) as Array<{ isAnimating?: boolean }>).some((variable) => Boolean(variable.isAnimating));

    if (hasAnimating) {
      let lastTime = performance.now();
      const animate = (time: number) => {
        const delta = (time - lastTime) / 1000;
        lastTime = time;

        setCartesianVariables((prev) => {
          let updated = false;
          const next = { ...prev };

          Object.keys(next).forEach((vName) => {
            const v = { ...next[vName] };
            if (v.isAnimating) {
              updated = true;
              let nextVal = v.val + (v.step || 0.1) * 20 * delta;
              if (nextVal > v.max) nextVal = v.min;
              v.val = parseFloat(nextVal.toFixed(2));
              next[vName] = v;
            }
          });

          if (updated) {
            onUpdate({ cartesianVariables: next });
          }
          return next;
        });

        animId = requestAnimationFrame(animate);
      };

      animId = requestAnimationFrame(animate);
    }

    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [cartesianVariables]);

  // Interactive Graphing States
  const [graphInteractionMode, setGraphInteractionMode] = useState<
    "none" | "point" | "line" | "erase" | "move"
  >("none");
  const [graphPan, setGraphPan] = useState({
    x: element.graphPanX || 0,
    y: element.graphPanY || 0,
  });
  const [isPanningGraph, setIsPanningGraph] = useState(false);
  const [lastPanPos, setLastPanPos] = useState({ x: 0, y: 0 });
  const [lineStartPoint, setLineStartPoint] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [draggingPointIdx, setDraggingPointIdx] = useState<number | null>(null);
  const [draggingLineIdx, setDraggingLineIdx] = useState<{
    idx: number;
    startX: number;
    startY: number;
    initialLine: { x1: number; y1: number; x2: number; y2: number };
  } | null>(null);
  const [tempLinesList, setTempLinesList] = useState(
    element.plottedLines || [],
  );

  useEffect(() => {
    setTempLinesList(element.plottedLines || []);
  }, [element.plottedLines]);
  const [tempPointsList, setTempPointsList] = useState<
    { x: number; y: number }[]
  >([]);

  useEffect(() => {
    setEquationInput(element.equation || "");
    setEquationsArray(element.equations || []);
    // Manual point input doesn't need to sync on load
    setRangeInput(element.cartesianRange || 5);
    setAxisFontSize(element.axisFontSize || 10);

    // Parse points for local drag state
    const parsed: { x: number; y: number }[] = [];
    if (element.plottedPoints) {
      const regex = /\((-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\)/g;
      let match;
      while ((match = regex.exec(element.plottedPoints)) !== null) {
        const px = parseFloat(match[1]);
        const py = parseFloat(match[2]);
        if (!isNaN(px) && !isNaN(py)) {
          parsed.push({ x: px, y: py });
        }
      }
    }
    setTempPointsList(parsed);
  }, [
    element.equation,
    element.equations,
    element.plottedPoints,
    element.cartesianRange,
    element.axisFontSize,
  ]);

  useEffect(() => {
    setText(element.text);
  }, [element.text]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    if (!canWrite) {
      setIsEditing(false);
      setShowEmojiPicker(false);
      setShowColorPicker(false);
      setShowMathPanel(false);
    }
  }, [canWrite]);

  const handleBlur = () => {
    setIsEditing(false);
    if (text !== element.text) {
      onUpdate({ text: text });
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
  };

  const handleEmojiClick = (emoji: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const currentReactions = element.reactions || {};
    const users = currentReactions[emoji] || [];

    let newUsers: string[];
    if (users.includes(currentUser.name)) {
      newUsers = users.filter((u) => u !== currentUser.name);
    } else {
      newUsers = [...users, currentUser.name];
    }

    const updatedReactions = { ...currentReactions };
    if (newUsers.length === 0) {
      delete updatedReactions[emoji];
    } else {
      updatedReactions[emoji] = newUsers;
    }

    onUpdate({ reactions: updatedReactions });
    setShowEmojiPicker(false);
  };

  // Helper to render SVG paths based on shape type
  const renderShapeSvg = () => {
    const w = element.width;
    const h = element.height;
    const fill = element.color;
    const stroke = element.borderColor;
    const strokeWidth = 2.5;

    switch (element.shapeType) {
      case "circle":
        return (
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox={`0 0 ${w} ${h}`}
            preserveAspectRatio="none"
          >
            <ellipse
              cx={w / 2}
              cy={h / 2}
              rx={(w - strokeWidth) / 2}
              ry={(h - strokeWidth) / 2}
              fill={fill}
              stroke={stroke}
              strokeWidth={strokeWidth}
            />
          </svg>
        );
      case "triangle":
        return (
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox={`0 0 ${w} ${h}`}
            preserveAspectRatio="none"
          >
            <polygon
              points={`${w / 2},${strokeWidth} ${strokeWidth},${h - strokeWidth} ${w - strokeWidth},${h - strokeWidth}`}
              fill={fill}
              stroke={stroke}
              strokeWidth={strokeWidth}
            />
          </svg>
        );
      case "diamond":
        return (
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox={`0 0 ${w} ${h}`}
            preserveAspectRatio="none"
          >
            <polygon
              points={`${w / 2},${strokeWidth} ${w - strokeWidth},${h / 2} ${w / 2},${h - strokeWidth} ${strokeWidth},${h / 2}`}
              fill={fill}
              stroke={stroke}
              strokeWidth={strokeWidth}
            />
          </svg>
        );
      case "star":
        return (
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox={`0 0 100 100`}
            preserveAspectRatio="none"
          >
            <polygon
              points="50,5 64,36 98,36 70,57 81,91 50,70 19,91 30,57 2,36 36,36"
              fill={fill}
              stroke={stroke}
              strokeWidth={strokeWidth}
            />
          </svg>
        );
      case "hexagon":
        return (
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox={`0 0 ${w} ${h}`}
            preserveAspectRatio="none"
          >
            <polygon
              points={`${w * 0.25},${strokeWidth} ${w * 0.75},${strokeWidth} ${w - strokeWidth},${h / 2} ${w * 0.75},${h - strokeWidth} ${w * 0.25},${h - strokeWidth} ${strokeWidth},${h / 2}`}
              fill={fill}
              stroke={stroke}
              strokeWidth={strokeWidth}
            />
          </svg>
        );
      case "pentagon":
        return (
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox={`0 0 ${w} ${h}`}
            preserveAspectRatio="none"
          >
            <polygon
              points={`${w / 2},${strokeWidth} ${w - strokeWidth},${h * 0.38} ${w * 0.82},${h - strokeWidth} ${w * 0.18},${h - strokeWidth} ${strokeWidth},${h * 0.38}`}
              fill={fill}
              stroke={stroke}
              strokeWidth={strokeWidth}
            />
          </svg>
        );
      case "parallelogram":
        return (
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox={`0 0 ${w} ${h}`}
            preserveAspectRatio="none"
          >
            <polygon
              points={`${w * 0.25},${strokeWidth} ${w - strokeWidth},${strokeWidth} ${w * 0.75},${h - strokeWidth} ${strokeWidth},${h - strokeWidth}`}
              fill={fill}
              stroke={stroke}
              strokeWidth={strokeWidth}
            />
          </svg>
        );
      case "right-triangle":
        return (
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox={`0 0 ${w} ${h}`}
            preserveAspectRatio="none"
          >
            <polygon
              points={`${strokeWidth},${strokeWidth} ${strokeWidth},${h - strokeWidth} ${w - strokeWidth},${h - strokeWidth}`}
              fill={fill}
              stroke={stroke}
              strokeWidth={strokeWidth}
            />
          </svg>
        );
      case "line":
        return (
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox={`0 0 ${w} ${h}`}
            preserveAspectRatio="none"
          >
            <line
              x1={strokeWidth}
              y1={h / 2}
              x2={w - strokeWidth}
              y2={h / 2}
              stroke={stroke}
              strokeWidth={strokeWidth * 1.5}
              strokeLinecap="round"
            />
          </svg>
        );
      case "advanced-cartesian": {
        const cx = w / 2 + graphPan.x;
        const cy = h / 2 + graphPan.y;
        const range = element.cartesianRange || 5;
        const scaleX = (w - 40) / (range * 2);
        const scaleY = (h - 40) / (range * 2);

        const gridLines: React.ReactNode[] = [];
        const xTicks: React.ReactNode[] = [];
        const yTicks: React.ReactNode[] = [];

        const minI = Math.min(
          Math.floor((10 - cx) / scaleX),
          Math.floor((cy - h + 10) / scaleY)
        ) - 1;
        const maxI = Math.max(
          Math.ceil((w - 10 - cx) / scaleX),
          Math.ceil((cy - 10) / scaleY)
        ) + 1;

        // 1. Grid Modes: Cartesian, Polar, Isometric
        if (gridMode === "polar") {
          const maxRadius = Math.max(range, Math.ceil(Math.hypot(w, h) / scaleX));
          for (let r = 1; r <= maxRadius; r++) {
            gridLines.push(
              <circle
                key={`polar-r-${r}`}
                cx={cx}
                cy={cy}
                r={r * scaleX}
                fill="none"
                stroke="rgba(148, 163, 184, 0.2)"
                strokeWidth={0.8}
                strokeDasharray="3 3"
              />
            );
          }
          for (let angle = 0; angle < 360; angle += 30) {
            const rad = (angle * Math.PI) / 180;
            const x2 = cx + Math.cos(rad) * scaleX * maxRadius;
            const y2 = cy - Math.sin(rad) * scaleY * maxRadius;
            gridLines.push(
              <line
                key={`polar-spoke-${angle}`}
                x1={cx}
                y1={cy}
                x2={x2}
                y2={y2}
                stroke="rgba(148, 163, 184, 0.2)"
                strokeWidth={0.8}
              />
            );
          }
        } else if (gridMode === "isometric") {
          for (let i = -maxI * 2; i <= maxI * 2; i += 2) {
            const xOffset = i * scaleX;
            gridLines.push(
              <line
                key={`iso-60-${i}`}
                x1={cx + xOffset - h}
                y1={cy + h}
                x2={cx + xOffset + h}
                y2={cy - h}
                stroke="rgba(148, 163, 184, 0.15)"
                strokeWidth={0.8}
              />,
              <line
                key={`iso-120-${i}`}
                x1={cx + xOffset - h}
                y1={cy - h}
                x2={cx + xOffset + h}
                y2={cy + h}
                stroke="rgba(148, 163, 184, 0.15)"
                strokeWidth={0.8}
              />
            );
          }
        } else {
          // Standard Rectangular Cartesian Grid
          for (let i = minI; i <= maxI; i++) {
            const xPos = cx + i * scaleX;
            const yPos = cy - i * scaleY;

            if (i !== 0 && xPos > 10 && xPos < w - 10) {
              gridLines.push(
                <line
                  key={`adv-grid-v-${i}`}
                  x1={xPos}
                  y1={15}
                  x2={xPos}
                  y2={h - 15}
                  stroke="rgba(148, 163, 184, 0.15)"
                  strokeWidth={0.8}
                />
              );
            }
            if (i !== 0 && yPos > 10 && yPos < h - 10) {
              gridLines.push(
                <line
                  key={`adv-grid-h-${i}`}
                  x1={15}
                  y1={yPos}
                  x2={w - 15}
                  y2={yPos}
                  stroke="rgba(148, 163, 184, 0.15)"
                  strokeWidth={0.8}
                />
              );
            }
          }
        }

        // 2. Axis Ticks & Labels (Pi-ticks vs Standard numbers)
        const tickStep = piTicks ? Math.PI / 2 : 1;
        const tickMin = Math.floor(minI / tickStep);
        const tickMax = Math.ceil(maxI / tickStep);

        for (let t = tickMin; t <= tickMax; t++) {
          const val = t * tickStep;
          if (Math.abs(val) < 0.001) continue;

          const xPos = cx + val * scaleX;
          const yPos = cy - val * scaleY;

          if (xPos > 15 && xPos < w - 15) {
            xTicks.push(
              <g key={`adv-xtick-${t}`}>
                <line x1={xPos} y1={cy - 4} x2={xPos} y2={cy + 4} stroke={stroke} strokeWidth={1.5} />
                <text
                  x={xPos}
                  y={cy + 12 + axisFontSize * 0.4}
                  textAnchor="middle"
                  fontSize={axisFontSize}
                  fontWeight="bold"
                  fill={stroke}
                  opacity={0.85}
                  className="select-none font-mono"
                >
                  {piTicks ? formatPiFraction(val) : val.toString()}
                </text>
              </g>
            );
          }

          if (yPos > 15 && yPos < h - 15) {
            yTicks.push(
              <g key={`adv-ytick-${t}`}>
                <line x1={cx - 4} y1={yPos} x2={cx + 4} y2={yPos} stroke={stroke} strokeWidth={1.5} />
                <text
                  x={cx - 10}
                  y={yPos + axisFontSize * 0.3}
                  textAnchor="end"
                  fontSize={axisFontSize}
                  fontWeight="bold"
                  fill={stroke}
                  opacity={0.85}
                  className="select-none font-mono"
                >
                  {piTicks ? formatPiFraction(val) : val.toString()}
                </text>
              </g>
            );
          }
        }

        // Multiple equations & Inequalities & Implicit Conics
        const equations = [
          {
            expr: element.equation || "",
            color: "#6366f1",
            label: "y1",
            min: element.equationMin,
            max: element.equationMax,
          },
          ...(element.equations || []).map((eq, i) => ({
            expr: eq.expr,
            color: eq.color,
            label: `y${i + 2}`,
            min: eq.min,
            max: eq.max,
          })),
        ];

        const equationPaths: React.ReactNode[] = [];
        const inequalityFills: React.ReactNode[] = [];
        const derivativePaths: React.ReactNode[] = [];

        equations.forEach(({ expr, color, label, min, max }, index) => {
          if (!expr) return;

          const parsed = parseInequality(expr);
          const cleanExpr = parsed.cleanExpr;
          const isImplicit = cleanExpr.includes("=") && cleanExpr.includes("x") && cleanExpr.includes("y");

          // Implicit Equation / Conic Section
          if (isImplicit) {
            const minPlotX = (10 - cx) / scaleX;
            const maxPlotX = (w - 10 - cx) / scaleX;
            const minPlotY = (cy - h + 10) / scaleY;
            const maxPlotY = (cy - 10) / scaleY;
            const implicitPathD = generateImplicitContourPath(
              cleanExpr,
              minPlotX,
              maxPlotX,
              minPlotY,
              maxPlotY,
              cx,
              cy,
              scaleX,
              scaleY,
              cartesianVariables
            );
            if (implicitPathD) {
              equationPaths.push(
                <path
                  key={`adv-implicit-${index}`}
                  d={implicitPathD}
                  fill="none"
                  stroke={color}
                  strokeWidth={3}
                  className="pointer-events-none drop-shadow-sm transition-all"
                />
              );
            }
            return;
          }

          // Explicit Equation / Inequality
          const numMin = min && !isNaN(parseFloat(min)) ? parseFloat(min) : undefined;
          const numMax = max && !isNaN(parseFloat(max)) ? parseFloat(max) : undefined;

          let curvePath = "";
          let fillPoints: { px: number; py: number }[] = [];
          let first = true;

          for (let px = 20; px <= w - 20; px += 2) {
            const xVal = (px - cx) / scaleX;
            if (numMin !== undefined && xVal < numMin) {
              first = true;
              continue;
            }
            if (numMax !== undefined && xVal > numMax) {
              first = true;
              continue;
            }

            const yVal = evaluateMathExpression(cleanExpr, xVal, cartesianVariables);
            if (yVal !== null && !isNaN(yVal) && isFinite(yVal)) {
              const py = cy - yVal * scaleY;
              if (py >= -h && py <= 2 * h) {
                if (first) {
                  curvePath += `M ${px} ${py}`;
                  first = false;
                } else {
                  curvePath += ` L ${px} ${py}`;
                }
                fillPoints.push({ px, py });
              } else {
                first = true;
              }
            }
          }

          if (curvePath) {
            // Shaded Inequality Fill Region
            if (parsed.isInequality && fillPoints.length > 1) {
              const boundaryY = parsed.op === "<" || parsed.op === "<=" ? h - 15 : 15;
              const firstPt = fillPoints[0];
              const lastPt = fillPoints[fillPoints.length - 1];
              const fillD = `${curvePath} L ${lastPt.px} ${boundaryY} L ${firstPt.px} ${boundaryY} Z`;

              inequalityFills.push(
                <path
                  key={`adv-ineq-${index}`}
                  d={fillD}
                  fill={color}
                  opacity={0.2}
                  className="pointer-events-none"
                />
              );
            }

            equationPaths.push(
              <g key={`adv-eq-${index}`}>
                <path
                  d={curvePath}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={20}
                  style={{ pointerEvents: "stroke", cursor: "default" }}
                />
                <path
                  d={curvePath}
                  fill="none"
                  stroke={color}
                  strokeWidth={3}
                  strokeDasharray={parsed.isStrict ? "6 4" : undefined}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="pointer-events-none drop-shadow-sm transition-all"
                />
              </g>
            );
          }

          // Live Tangent / Derivative Curve f'(x)
          if (showDerivative && !parsed.isInequality) {
            let derivPath = "";
            let dFirst = true;
            for (let px = 20; px <= w - 20; px += 3) {
              const xVal = (px - cx) / scaleX;
              const yPlus = evaluateMathExpression(cleanExpr, xVal + 0.005, cartesianVariables);
              const yMinus = evaluateMathExpression(cleanExpr, xVal - 0.005, cartesianVariables);
              if (yPlus !== null && yMinus !== null) {
                const dy = (yPlus - yMinus) / 0.01;
                if (!isNaN(dy) && isFinite(dy)) {
                  const py = cy - dy * scaleY;
                  if (py >= 0 && py <= h) {
                    if (dFirst) {
                      derivPath += `M ${px} ${py}`;
                      dFirst = false;
                    } else {
                      derivPath += ` L ${px} ${py}`;
                    }
                  } else {
                    dFirst = true;
                  }
                }
              }
            }
            if (derivPath) {
              derivativePaths.push(
                <path
                  key={`adv-deriv-${index}`}
                  d={derivPath}
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  className="pointer-events-none opacity-80"
                />
              );
            }
          }
        });

        // 3. Critical Points Snapping (Roots, Y-Intercepts, Extrema, Intersections)
        const criticalPointsList = calculateCriticalPoints(equations, minI, maxI, cartesianVariables);

        // 4. Data Table Points & Auto-Fit Linear Regression
        let regressionLineNode: React.ReactNode = null;
        let regressionInfo: { slope: number; intercept: number; rSquared: number } | null = null;

        if (showRegression && tablePoints.length >= 2) {
          regressionInfo = calculateLinearRegression(tablePoints);
          if (regressionInfo) {
            const { slope, intercept } = regressionInfo;
            const x1 = minI;
            const y1 = slope * x1 + intercept;
            const x2 = maxI;
            const y2 = slope * x2 + intercept;

            regressionLineNode = (
              <line
                x1={cx + x1 * scaleX}
                y1={cy - y1 * scaleY}
                x2={cx + x2 * scaleX}
                y2={cy - y2 * scaleY}
                stroke="#10b981"
                strokeWidth={2}
                strokeDasharray="6 3"
                className="pointer-events-none drop-shadow-xs"
              />
            );
          }
        }

        // 5. Live Tangent Line & Slope Inspection Probe
        let inspectionLineNode: React.ReactNode = null;
        let inspectionPointNode: React.ReactNode = null;

        if (showInspection && equations[0]?.expr) {
          const parsed0 = parseInequality(equations[0].expr);
          const yProbe = evaluateMathExpression(parsed0.cleanExpr, inspectionX, cartesianVariables);
          const yPlus = evaluateMathExpression(parsed0.cleanExpr, inspectionX + 0.005, cartesianVariables);
          const yMinus = evaluateMathExpression(parsed0.cleanExpr, inspectionX - 0.005, cartesianVariables);

          if (yProbe !== null && yPlus !== null && yMinus !== null) {
            const slopeM = (yPlus - yMinus) / 0.01;
            const cIntercept = yProbe - slopeM * inspectionX;

            const tanX1 = inspectionX - 3;
            const tanY1 = slopeM * tanX1 + cIntercept;
            const tanX2 = inspectionX + 3;
            const tanY2 = slopeM * tanX2 + cIntercept;

            const px = cx + inspectionX * scaleX;
            const py = cy - yProbe * scaleY;

            inspectionLineNode = (
              <line
                x1={cx + tanX1 * scaleX}
                y1={cy - tanY1 * scaleY}
                x2={cx + tanX2 * scaleX}
                y2={cy - tanY2 * scaleY}
                stroke="#f59e0b"
                strokeWidth={2.5}
                className="pointer-events-none drop-shadow-sm"
              />
            );

            inspectionPointNode = (
              <g className="pointer-events-none">
                <circle cx={px} cy={py} r={6} fill="#f59e0b" stroke="#ffffff" strokeWidth={2} />
                <rect x={px - 45} y={py - 28} width="90" height="18" rx="4" fill="rgba(15, 23, 42, 0.9)" />
                <text x={px} y={py - 16} fontSize="8" fontWeight="bold" fill="#fde047" textAnchor="middle" className="font-mono">
                  {`x=${inspectionX.toFixed(1)}, m=${slopeM.toFixed(2)}`}
                </text>
              </g>
            );
          }
        }

        return (
          <svg
            className="absolute inset-0 w-full h-full"
            style={{
              pointerEvents: "auto",
              backgroundColor: fill || "rgba(255,255,255,0.95)",
              borderRadius: "12px",
              border: `1.5px solid ${stroke}40`,
              cursor: ["point", "line", "erase"].includes(graphInteractionMode)
                ? "crosshair"
                : graphInteractionMode === "move"
                  ? "move"
                  : "default",
            }}
            onPointerDown={(e) => {
              if (activeTool === "eraser" || (activeTool === "select" && !isSelected)) return;
              if (graphInteractionMode !== "none") {
                e.stopPropagation();
              }
              if (graphInteractionMode === "move") {
                setIsPanningGraph(true);
                setLastPanPos({ x: e.clientX, y: e.clientY });
              }
            }}
            onMouseMove={(e) => {
              if (isPanningGraph) {
                const dx = e.clientX - lastPanPos.x;
                const dy = e.clientY - lastPanPos.y;
                setGraphPan({ x: graphPan.x + dx, y: graphPan.y + dy });
                setLastPanPos({ x: e.clientX, y: e.clientY });
                return;
              }
              const rect = e.currentTarget.getBoundingClientRect();
              const scaleRatioX = w / rect.width;
              const scaleRatioY = h / rect.height;
              const x = (e.clientX - rect.left) * scaleRatioX;
              const y = (e.clientY - rect.top) * scaleRatioY;
              const plotX = (x - cx) / scaleX;
              const plotY = (cy - y) / scaleY;

              if (x >= 10 && x <= w - 10 && y >= 10 && y <= h - 10) {
                setHoveredCoord({ x: plotX, y: plotY });
              } else {
                setHoveredCoord(null);
              }

              if (draggingPointIdx !== null) {
                const newPoints = [...tempPointsList];
                newPoints[draggingPointIdx] = { x: plotX, y: plotY };
                setTempPointsList(newPoints);
              }
              if (draggingLineIdx !== null) {
                const dx = plotX - draggingLineIdx.startX;
                const dy = plotY - draggingLineIdx.startY;
                const newLines = [...tempLinesList];
                newLines[draggingLineIdx.idx] = {
                  ...newLines[draggingLineIdx.idx],
                  x1: draggingLineIdx.initialLine.x1 + dx,
                  y1: draggingLineIdx.initialLine.y1 + dy,
                  x2: draggingLineIdx.initialLine.x2 + dx,
                  y2: draggingLineIdx.initialLine.y2 + dy,
                };
                setTempLinesList(newLines);
              }
            }}
            onMouseLeave={() => {
              if (isPanningGraph) {
                setIsPanningGraph(false);
                onUpdate({ graphPanX: graphPan.x, graphPanY: graphPan.y });
                return;
              }
              setHoveredCoord(null);
              if (draggingPointIdx !== null) {
                const ptsStr = tempPointsList
                  .map((p) => `(${p.x.toFixed(2)},${p.y.toFixed(2)})`)
                  .join(", ");
                onUpdate({ plottedPoints: ptsStr });
                setDraggingPointIdx(null);
              }
              if (draggingLineIdx !== null) {
                onUpdate({ plottedLines: tempLinesList });
                setDraggingLineIdx(null);
              }
            }}
            onMouseUp={() => {
              if (isPanningGraph) {
                setIsPanningGraph(false);
                onUpdate({ graphPanX: graphPan.x, graphPanY: graphPan.y });
                return;
              }
              if (draggingPointIdx !== null) {
                const ptsStr = tempPointsList
                  .map((p) => `(${p.x.toFixed(2)},${p.y.toFixed(2)})`)
                  .join(", ");
                onUpdate({ plottedPoints: ptsStr });
                setDraggingPointIdx(null);
              }
              if (draggingLineIdx !== null) {
                onUpdate({ plottedLines: tempLinesList });
                setDraggingLineIdx(null);
              }
            }}
            onClick={(e) => {
              if (!isSelected) return;
              if (draggingPointIdx !== null) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const scaleRatioX = w / rect.width;
              const scaleRatioY = h / rect.height;
              const x = (e.clientX - rect.left) * scaleRatioX;
              const y = (e.clientY - rect.top) * scaleRatioY;
              const plotX = (x - cx) / scaleX;
              const plotY = (cy - y) / scaleY;

              if (graphInteractionMode === "point") {
                const newPoints = [...tempPointsList, { x: plotX, y: plotY }];
                setTempPointsList(newPoints);
                const ptsStr = newPoints
                  .map((p) => `(${p.x.toFixed(2)},${p.y.toFixed(2)})`)
                  .join(", ");
                onUpdate({ plottedPoints: ptsStr });
              } else if (graphInteractionMode === "line") {
                if (!lineStartPoint) {
                  setLineStartPoint({ x: plotX, y: plotY });
                } else {
                  const newLine = {
                    id: Math.random().toString(),
                    x1: lineStartPoint.x,
                    y1: lineStartPoint.y,
                    x2: plotX,
                    y2: plotY,
                  };
                  const newLines = [...(element.plottedLines || []), newLine];
                  onUpdate({ plottedLines: newLines });
                  setLineStartPoint(null);
                }
              }
            }}
          >
            <defs>
              <marker
                id={`arrow-${element.id}`}
                viewBox="0 0 10 10"
                refX="5"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 2 L 10 5 L 0 8 z" fill={stroke} />
              </marker>
            </defs>

            {/* Grid lines */}
            {gridLines}

            {/* Inequality Region Shading */}
            {inequalityFills}

            {/* X Axis */}
            <line
              x1={15}
              y1={cy}
              x2={w - 15}
              y2={cy}
              stroke={stroke}
              strokeWidth={2}
              markerStart={`url(#arrow-${element.id})`}
              markerEnd={`url(#arrow-${element.id})`}
            />
            {/* Y Axis */}
            <line
              x1={cx}
              y1={15}
              x2={cx}
              y2={h - 15}
              stroke={stroke}
              strokeWidth={2}
              markerStart={`url(#arrow-${element.id})`}
              markerEnd={`url(#arrow-${element.id})`}
            />

            {/* Origin Label */}
            <text
              x={cx - axisFontSize * 0.9}
              y={cy + axisFontSize * 1.2}
              fontSize={axisFontSize}
              fontWeight="bold"
              fill={stroke}
              opacity={0.85}
              className="select-none font-mono"
            >
              0
            </text>

            {/* Axis Name Labels */}
            <text
              x={w - 22}
              y={cy - 8}
              fontSize="11"
              fontWeight="bold"
              fill={stroke}
              className="select-none font-sans italic"
            >
              x
            </text>
            <text
              x={cx + 8}
              y={25}
              fontSize="11"
              fontWeight="bold"
              fill={stroke}
              className="select-none font-sans italic"
            >
              y
            </text>

            {/* Ticks & Numbers */}
            {xTicks}
            {yTicks}

            {/* Derivative Curves */}
            {derivativePaths}

            {/* Tangent Line Probe */}
            {inspectionLineNode}

            {/* Equation Curves & Implicit Conics */}
            {equationPaths}

            {/* Tangent Point Probe */}
            {inspectionPointNode}

            {/* Data Table Points */}
            {tablePoints.map((pt, idx) => {
              const px = cx + pt.x * scaleX;
              const py = cy - pt.y * scaleY;
              if (px >= 10 && px <= w - 10 && py >= 10 && py <= h - 10) {
                return (
                  <g key={`tbl-pt-${idx}`}>
                    <circle cx={px} cy={py} r={5} fill="#0284c7" stroke="#ffffff" strokeWidth={1.5} />
                  </g>
                );
              }
              return null;
            })}

            {/* Auto-Fit Linear Regression Line */}
            {regressionLineNode}

            {/* Critical Points Snapping Highlights (Roots, Extrema, Intersections) */}
            {criticalPointsList.map((pt, idx) => {
              const xPos = cx + pt.x * scaleX;
              const yPos = cy - pt.y * scaleY;
              if (xPos < 10 || xPos > w - 10 || yPos < 10 || yPos > h - 10) return null;

              return (
                <g
                  key={`adv-crit-${idx}`}
                  className="group/crit cursor-pointer"
                  onMouseEnter={() => setHoveredCritPoint(pt)}
                  onMouseLeave={() => setHoveredCritPoint(null)}
                >
                  <circle
                    cx={xPos}
                    cy={yPos}
                    r={6}
                    fill={pt.color}
                    stroke="#ffffff"
                    strokeWidth={2}
                    className="transition-transform hover:scale-125"
                  />
                  <circle
                    cx={xPos}
                    cy={yPos}
                    r={10}
                    fill="none"
                    stroke={pt.color}
                    strokeWidth={1}
                    className="animate-ping opacity-40"
                  />
                  {/* Popover Tooltip on Hover */}
                  <g className="opacity-0 group-hover/crit:opacity-100 transition-opacity pointer-events-none">
                    <rect
                      x={xPos - 45}
                      y={yPos - 28}
                      width="90"
                      height="20"
                      rx="4"
                      fill="rgba(15, 23, 42, 0.95)"
                    />
                    <text
                      x={xPos}
                      y={yPos - 15}
                      fontSize="8"
                      fontWeight="bold"
                      fill="#ffffff"
                      textAnchor="middle"
                      className="font-mono"
                    >
                      {`${pt.label}: (${pt.x.toFixed(2)}, ${pt.y.toFixed(2)})`}
                    </text>
                  </g>
                </g>
              );
            })}

            {/* Manual Plotted Lines */}
            {tempLinesList.map((line, idx) => {
              const x1Pos = cx + line.x1 * scaleX;
              const y1Pos = cy - line.y1 * scaleY;
              const x2Pos = cx + line.x2 * scaleX;
              const y2Pos = cy - line.y2 * scaleY;
              return (
                <g key={`adv-line-${line.id}`}>
                  <line
                    x1={x1Pos}
                    y1={y1Pos}
                    x2={x2Pos}
                    y2={y2Pos}
                    stroke="transparent"
                    strokeWidth={20}
                    style={{
                      pointerEvents: "stroke",
                      cursor:
                        graphInteractionMode === "none" ||
                        graphInteractionMode === "move"
                          ? draggingLineIdx?.idx === idx
                            ? "grabbing"
                            : "grab"
                          : "crosshair",
                    }}
                    onPointerDown={(e) => {
                      if (activeTool === "eraser" || (activeTool === "select" && !isSelected)) return;
                      if (
                        graphInteractionMode === "point" ||
                        graphInteractionMode === "line"
                      )
                        return;
                      e.stopPropagation();
                      const rect = e.currentTarget
                        .closest("svg")!
                        .getBoundingClientRect();
                      const plotX =
                        ((e.clientX - rect.left) * (w / rect.width) - cx) /
                        scaleX;
                      const plotY =
                        (cy - (e.clientY - rect.top) * (h / rect.height)) /
                        scaleY;
                      setDraggingLineIdx({
                        idx,
                        startX: plotX,
                        startY: plotY,
                        initialLine: {
                          x1: line.x1,
                          y1: line.y1,
                          x2: line.x2,
                          y2: line.y2,
                        },
                      });
                    }}
                  />
                  <line
                    x1={x1Pos}
                    y1={y1Pos}
                    x2={x2Pos}
                    y2={y2Pos}
                    stroke="#10b981"
                    strokeWidth={3}
                    className="pointer-events-none drop-shadow-sm transition-all"
                  />
                </g>
              );
            })}

            {/* Active Drawing Line */}
            {lineStartPoint &&
              hoveredCoord &&
              graphInteractionMode === "line" && (
                <line
                  x1={cx + lineStartPoint.x * scaleX}
                  y1={cy - lineStartPoint.y * scaleY}
                  x2={cx + hoveredCoord.x * scaleX}
                  y2={cy - hoveredCoord.y * scaleY}
                  stroke="#10b981"
                  strokeWidth={2}
                  strokeDasharray="5,5"
                  opacity={0.6}
                />
              )}

            {/* Manual Plotted Points */}
            {tempPointsList.map((pt, idx) => {
              const xPos = cx + pt.x * scaleX;
              const yPos = cy - pt.y * scaleY;

              if (
                xPos >= 10 &&
                xPos <= w - 10 &&
                yPos >= 10 &&
                yPos <= h - 10
              ) {
                return (
                  <g key={`adv-pt-${idx}`}>
                    <circle
                      cx={xPos}
                      cy={yPos}
                      r={20}
                      fill="transparent"
                      style={{
                        pointerEvents: "all",
                        cursor:
                          graphInteractionMode === "none" ||
                          graphInteractionMode === "move"
                            ? draggingPointIdx === idx
                              ? "grabbing"
                              : "grab"
                            : "crosshair",
                      }}
                      onPointerDown={(e) => {
                        if (activeTool === "eraser" || (activeTool === "select" && !isSelected)) return;
                        if (
                          graphInteractionMode === "point" ||
                          graphInteractionMode === "line"
                        )
                          return;
                        e.stopPropagation();
                        setDraggingPointIdx(idx);
                      }}
                    />
                    <circle
                      cx={xPos}
                      cy={yPos}
                      r={6}
                      fill="#ec4899"
                      stroke="#ffffff"
                      strokeWidth={2}
                      className="pointer-events-none drop-shadow-sm"
                    />
                    <text
                      x={xPos + 8}
                      y={yPos - 6}
                      fontSize={Math.max(10, axisFontSize * 0.8)}
                      fontWeight="bold"
                      fill="#be185d"
                      className="font-mono bg-white/80 select-none pointer-events-none"
                    >
                      ({pt.x.toFixed(1)}, {pt.y.toFixed(1)})
                    </text>
                  </g>
                );
              }
              return null;
            })}

            {/* Hovered Dynamic Coordinate HUD */}
            {hoveredCoord && (
              <g>
                <line
                  x1={cx + hoveredCoord.x * scaleX}
                  y1={cy - hoveredCoord.y * scaleY}
                  x2={cx}
                  y2={cy - hoveredCoord.y * scaleY}
                  stroke="#818cf8"
                  strokeWidth={1}
                  strokeDasharray="3,3"
                  opacity={0.8}
                />
                <line
                  x1={cx + hoveredCoord.x * scaleX}
                  y1={cy - hoveredCoord.y * scaleY}
                  x2={cx + hoveredCoord.x * scaleX}
                  y2={cy}
                  stroke="#818cf8"
                  strokeWidth={1}
                  strokeDasharray="3,3"
                  opacity={0.8}
                />
                <circle
                  cx={cx + hoveredCoord.x * scaleX}
                  cy={cy - hoveredCoord.y * scaleY}
                  r={4.5}
                  fill="#4f46e5"
                  stroke="#ffffff"
                  strokeWidth={1.5}
                />
                <g transform={`translate(${w - 95}, ${h - 32})`}>
                  <rect
                    width="80"
                    height="20"
                    rx="5"
                    fill="rgba(15, 23, 42, 0.85)"
                  />
                  <text
                    x="40"
                    y="13"
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize="9"
                    fontWeight="bold"
                    className="font-mono"
                  >
                    ({hoveredCoord.x.toFixed(1)}, {hoveredCoord.y.toFixed(1)})
                  </text>
                </g>
              </g>
            )}
          </svg>
        );
      }
      case "cartesian": {
        const cx = w / 2;
        const cy = h / 2;
        const gridStep = 30;
        const gridLines: React.ReactNode[] = [];

        // Vertical grid lines (left of center)
        for (let x = cx - gridStep; x > 0; x -= gridStep) {
          gridLines.push(
            <line
              key={`grid-v-left-${x}`}
              x1={x}
              y1={0}
              x2={x}
              y2={h}
              stroke="rgba(148, 163, 184, 0.2)"
              strokeWidth={0.8}
            />,
          );
        }
        // Vertical grid lines (right of center)
        for (let x = cx + gridStep; x < w; x += gridStep) {
          gridLines.push(
            <line
              key={`grid-v-right-${x}`}
              x1={x}
              y1={0}
              x2={x}
              y2={h}
              stroke="rgba(148, 163, 184, 0.2)"
              strokeWidth={0.8}
            />,
          );
        }
        // Horizontal grid lines (above center)
        for (let y = cy - gridStep; y > 0; y -= gridStep) {
          gridLines.push(
            <line
              key={`grid-h-above-${y}`}
              x1={0}
              y1={y}
              x2={w}
              y2={y}
              stroke="rgba(148, 163, 184, 0.2)"
              strokeWidth={0.8}
            />,
          );
        }
        // Horizontal grid lines (below center)
        for (let y = cy + gridStep; y < h; y += gridStep) {
          gridLines.push(
            <line
              key={`grid-h-below-${y}`}
              x1={0}
              y1={y}
              x2={w}
              y2={y}
              stroke="rgba(148, 163, 184, 0.2)"
              strokeWidth={0.8}
            />,
          );
        }

        // Draw ticks and tick numbers on X axis
        const xTicks: React.ReactNode[] = [];
        let tickNum = 1;
        for (let x = cx + gridStep; x < w - 15; x += gridStep) {
          xTicks.push(
            <g key={`xtick-pos-${x}`}>
              <line
                x1={x}
                y1={cy - 4}
                x2={x}
                y2={cy + 4}
                stroke={stroke}
                strokeWidth={1.5}
              />
              <text
                x={x}
                y={cy + 13}
                textAnchor="middle"
                fontSize="9"
                fontWeight="bold"
                fill={stroke}
                opacity={0.85}
                className="select-none font-mono"
              >
                {tickNum}
              </text>
            </g>,
          );
          tickNum++;
        }
        tickNum = -1;
        for (let x = cx - gridStep; x > 15; x -= gridStep) {
          xTicks.push(
            <g key={`xtick-neg-${x}`}>
              <line
                x1={x}
                y1={cy - 4}
                x2={x}
                y2={cy + 4}
                stroke={stroke}
                strokeWidth={1.5}
              />
              <text
                x={x}
                y={cy + 13}
                textAnchor="middle"
                fontSize="9"
                fontWeight="bold"
                fill={stroke}
                opacity={0.85}
                className="select-none font-mono"
              >
                {tickNum}
              </text>
            </g>,
          );
          tickNum--;
        }

        // Draw ticks and tick numbers on Y axis
        const yTicks: React.ReactNode[] = [];
        tickNum = 1;
        for (let y = cy - gridStep; y > 15; y -= gridStep) {
          yTicks.push(
            <g key={`ytick-pos-${y}`}>
              <line
                x1={cx - 4}
                y1={y}
                x2={cx + 4}
                y2={y}
                stroke={stroke}
                strokeWidth={1.5}
              />
              <text
                x={cx - 10}
                y={y + 3}
                textAnchor="end"
                fontSize="9"
                fontWeight="bold"
                fill={stroke}
                opacity={0.85}
                className="select-none font-mono"
              >
                {tickNum}
              </text>
            </g>,
          );
          tickNum++;
        }
        tickNum = -1;
        for (let y = cy + gridStep; y < h - 15; y += gridStep) {
          yTicks.push(
            <g key={`ytick-neg-${y}`}>
              <line
                x1={cx - 4}
                y1={y}
                x2={cx + 4}
                y2={y}
                stroke={stroke}
                strokeWidth={1.5}
              />
              <text
                x={cx - 10}
                y={y + 3}
                textAnchor="end"
                fontSize="9"
                fontWeight="bold"
                fill={stroke}
                opacity={0.85}
                className="select-none font-mono"
              >
                {tickNum}
              </text>
            </g>,
          );
          tickNum--;
        }

        return (
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox={`0 0 ${w} ${h}`}
            style={{
              backgroundColor: fill || "rgba(255,255,255,0.92)",
              borderRadius: "12px",
              border: `1px solid ${stroke}25`,
            }}
          >
            <defs>
              <marker
                id={`arrow-${element.id}`}
                viewBox="0 0 10 10"
                refX="5"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 2 L 10 5 L 0 8 z" fill={stroke} />
              </marker>
            </defs>

            {/* Grid lines */}
            {gridLines}

            {/* X Axis */}
            <line
              x1={15}
              y1={cy}
              x2={w - 15}
              y2={cy}
              stroke={stroke}
              strokeWidth={2}
              markerStart={`url(#arrow-${element.id})`}
              markerEnd={`url(#arrow-${element.id})`}
            />
            {/* Y Axis */}
            <line
              x1={cx}
              y1={15}
              x2={cx}
              y2={h - 15}
              stroke={stroke}
              strokeWidth={2}
              markerStart={`url(#arrow-${element.id})`}
              markerEnd={`url(#arrow-${element.id})`}
            />

            {/* Origin Label */}
            <text
              x={cx - 8}
              y={cy + 11}
              fontSize="9"
              fontWeight="bold"
              fill={stroke}
              opacity={0.85}
              className="select-none font-mono"
            >
              0
            </text>

            {/* Axis Name Labels */}
            <text
              x={w - 22}
              y={cy - 8}
              fontSize="11"
              fontWeight="bold"
              fill={stroke}
              className="select-none font-sans italic"
            >
              x
            </text>
            <text
              x={cx + 8}
              y={25}
              fontSize="11"
              fontWeight="bold"
              fill={stroke}
              className="select-none font-sans italic"
            >
              y
            </text>

            {/* Ticks & Numbers */}
            {xTicks}
            {yTicks}
          </svg>
        );
      }
      case "numberline": {
        const cy = h / 2 - 5;
        const cx = w / 2;
        const step = 35;
        const tickLines: React.ReactNode[] = [];

        // Center tick
        tickLines.push(
          <g key="numtick-0">
            <line
              x1={cx}
              y1={cy - 6}
              x2={cx}
              y2={cy + 6}
              stroke={stroke}
              strokeWidth={2}
            />
            <text
              x={cx}
              y={cy + 18}
              textAnchor="middle"
              fontSize="10"
              fontWeight="extrabold"
              fill={stroke}
              opacity={0.9}
              className="select-none font-mono"
            >
              0
            </text>
          </g>,
        );

        // Positive ticks
        let val = 1;
        for (let x = cx + step; x < w - 20; x += step) {
          tickLines.push(
            <g key={`numtick-pos-${x}`}>
              <line
                x1={x}
                y1={cy - 5}
                x2={x}
                y2={cy + 5}
                stroke={stroke}
                strokeWidth={1.5}
              />
              <text
                x={x}
                y={cy + 16}
                textAnchor="middle"
                fontSize="9"
                fontWeight="bold"
                fill={stroke}
                opacity={0.85}
                className="select-none font-mono"
              >
                {val}
              </text>
            </g>,
          );
          val++;
        }

        // Negative ticks
        val = -1;
        for (let x = cx - step; x > 20; x -= step) {
          tickLines.push(
            <g key={`numtick-neg-${x}`}>
              <line
                x1={x}
                y1={cy - 5}
                x2={x}
                y2={cy + 5}
                stroke={stroke}
                strokeWidth={1.5}
              />
              <text
                x={x}
                y={cy + 16}
                textAnchor="middle"
                fontSize="9"
                fontWeight="bold"
                fill={stroke}
                opacity={0.85}
                className="select-none font-mono"
              >
                {val}
              </text>
            </g>,
          );
          val--;
        }

        return (
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox={`0 0 ${w} ${h}`}
            style={{ backgroundColor: fill || "transparent" }}
          >
            <defs>
              <marker
                id={`arrow-${element.id}`}
                viewBox="0 0 10 10"
                refX="5"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 2 L 10 5 L 0 8 z" fill={stroke} />
              </marker>
            </defs>

            {/* The main horizontal line */}
            <line
              x1={20}
              y1={cy}
              x2={w - 20}
              y2={cy}
              stroke={stroke}
              strokeWidth={2.5}
              markerStart={`url(#arrow-${element.id})`}
              markerEnd={`url(#arrow-${element.id})`}
            />

            {/* Ticks & values */}
            {tickLines}
          </svg>
        );
      }
      case "rect":
      default:
        return (
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox={`0 0 ${w} ${h}`}
            preserveAspectRatio="none"
          >
            <rect
              x={strokeWidth / 2}
              y={strokeWidth / 2}
              width={w - strokeWidth}
              height={h - strokeWidth}
              rx={6}
              ry={6}
              fill={fill}
              stroke={stroke}
              strokeWidth={strokeWidth}
            />
          </svg>
        );
    }
  };

  const getTextContainerStyle = () => {
    switch (element.shapeType) {
      case "triangle":
        return {
          paddingTop: "35%",
          paddingBottom: "12%",
          paddingLeft: "15%",
          paddingRight: "15%",
        };
      case "diamond":
        return {
          paddingTop: "20%",
          paddingBottom: "20%",
          paddingLeft: "20%",
          paddingRight: "20%",
        };
      case "star":
        return {
          paddingTop: "25%",
          paddingBottom: "25%",
          paddingLeft: "25%",
          paddingRight: "25%",
        };
      case "pentagon":
        return {
          paddingTop: "25%",
          paddingBottom: "12%",
          paddingLeft: "15%",
          paddingRight: "15%",
        };
      case "right-triangle":
        return {
          paddingTop: "35%",
          paddingBottom: "10%",
          paddingLeft: "25%",
          paddingRight: "10%",
        };
      case "parallelogram":
        return {
          paddingTop: "12%",
          paddingBottom: "12%",
          paddingLeft: "20%",
          paddingRight: "20%",
        };
      case "circle":
        return {
          paddingTop: "15%",
          paddingBottom: "15%",
          paddingLeft: "15%",
          paddingRight: "15%",
        };
      case "hexagon":
        return {
          paddingTop: "12%",
          paddingBottom: "12%",
          paddingLeft: "15%",
          paddingRight: "15%",
        };
      default:
        // Use a tighter default padding (10px) than the old static 24px (p-6)
        // so smaller rectangular/sticky notes can fit more text!
        return {
          paddingTop: "10px",
          paddingBottom: "10px",
          paddingLeft: "10px",
          paddingRight: "10px",
        };
    }
  };

  const isDarkFill = element.color === "#4b5563";
  const textColorClass = isDarkFill ? "text-white" : "text-slate-800";

  const cursorClass = element.locked
    ? "cursor-default"
    : activeTool === "select"
      ? "cursor-grab active:cursor-grabbing"
      : activeTool === "eraser"
        ? "cursor-pointer hover:brightness-95 hover:ring-2 hover:ring-rose-500 hover:ring-offset-1 transition-all"
        : "cursor-default";

  return (
    <div
      onPointerDown={onSelect}
      className={`absolute select-none flex flex-col justify-between transition-shadow duration-150 group ${cursorClass} ${
        isSelected ? "" : "hover:shadow-xs"
      }`}
      style={{
        left: element.x,
        top: element.y,
        width: element.width,
        height: element.height,
        zIndex: isSelected ? 40 : (element.zIndex ?? 10),
      }}
      id={`shape-${element.id}`}
    >
      {/* Visual SVG Shape Layer */}
      {renderShapeSvg()}

      {/* Selected Border Highlight */}
      {isSelected && (
        <div
          className="absolute inset-0 border-2 border-blue-600 rounded-xl pointer-events-none z-10"
          style={{ margin: "-2px" }}
        />
      )}

      {/* Text Container centered inside shape */}
      {!(
        element.shapeType === "cartesian" ||
        element.shapeType === "advanced-cartesian" ||
        element.shapeType === "numberline"
      ) && (
        <div 
          className="absolute inset-0 flex items-center justify-center overflow-hidden z-10"
          style={getTextContainerStyle()}
        >
          {isEditing && !element.locked ? (
            <textarea
              ref={textareaRef}
              value={text}
              onChange={handleTextChange}
              onBlur={handleBlur}
              className={`w-full h-full bg-transparent border-none resize-none focus:outline-none text-center font-bold text-sm ${textColorClass}`}
              placeholder="Type note..."
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  textareaRef.current?.blur();
                }
              }}
            />
          ) : (
            <div
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (!canWrite || element.locked) return;
                setIsEditing(true);
              }}
              className={`w-full h-full text-center flex items-center justify-center font-bold text-sm overflow-auto select-text break-words cursor-text ${textColorClass}`}
              style={{ whiteSpace: "pre-wrap" }}
            >
              {element.text ||
                (canWrite ? (
                  <span className="opacity-20 italic text-xs">Double tap</span>
                ) : (
                  ""
                ))}
            </div>
          )}
        </div>
      )}

      {/* Floating Emoji Bar Above the Shape (Lucidspark style) */}
      {isSelected && !isDraggingOrResizing && (
        <div
          onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
          className="absolute -top-12 left-1/2 -translate-x-1/2 bg-white border border-slate-200 rounded-full shadow-lg px-2.5 py-1.5 flex items-center space-x-2 z-30 animate-fade-in whitespace-nowrap animate-scale-up"
        >
          {/* Reaction Emojis list */}
          <div className="flex items-center space-x-1 border-r border-slate-100 pr-2">
            {/* Lock Trigger */}
            {canWrite && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdate({ locked: !element.locked });
                }}
                className={`w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer ${
                  element.locked ? "text-amber-600 bg-amber-50" : "text-slate-500"
                }`}
                title={element.locked ? "Unlock Shape" : "Lock Shape"}
              >
                {element.locked ? <Lock size={14} /> : <Unlock size={14} />}
              </button>
            )}

            {EMOJIS.map((emoji) => {
              const users = (element.reactions || {})[emoji] || [];
              const isReacted = users.includes(currentUser.name);
              return (
                <button
                  key={emoji}
                  onClick={(e) => handleEmojiClick(emoji, e)}
                  className={`w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center text-sm transition-transform hover:scale-125 ${
                    isReacted ? "bg-blue-100 ring-1 ring-blue-400" : ""
                  }`}
                  title={
                    users.length > 0 ? `${emoji}: ${users.join(", ")}` : emoji
                  }
                >
                  {emoji}
                </button>
              );
            })}
          </div>
          {/* Quick Color Selector */}
          {canWrite && (
            <div className="relative border-r border-slate-100 pr-2 flex items-center">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowColorPicker(!showColorPicker);
                }}
                className="w-6 h-6 rounded-full border border-slate-300 relative transition-transform hover:scale-110 flex items-center justify-center cursor-pointer shadow-xs"
                style={{
                  backgroundColor:
                    element.shapeType === "cartesian" ||
                    element.shapeType === "advanced-cartesian" ||
                    element.shapeType === "numberline" ||
                    element.shapeType === "line"
                      ? element.borderColor || "#1e293b"
                      : element.color || "#ffffff",
                }}
                title="Change color"
              >
                <div className="w-1.5 h-1.5 rounded-full bg-slate-800/30" />
              </button>

              {showColorPicker && (
                <div className="absolute bottom-9 left-1/2 -translate-x-1/2 bg-white border border-slate-200 rounded-2xl shadow-xl p-2.5 grid grid-cols-8 gap-1.5 z-40 animate-scale-up w-[212px]">
                  {[
                    "#fef08a",
                    "#fbcfe8",
                    "#bfdbfe",
                    "#bbf7d0",
                    "#fed7aa",
                    "#e9d5ff",
                    "#99f6e4",
                    "#fecaca",
                    "#e11d48",
                    "#f97316",
                    "#059669",
                    "#2563eb",
                    "#7c3aed",
                    "#64748b",
                    "#ffffff",
                    "#000000",
                  ].map((color) => {
                    const isSelected =
                      element.shapeType === "cartesian" ||
                      element.shapeType === "advanced-cartesian" ||
                      element.shapeType === "numberline" ||
                      element.shapeType === "line"
                        ? element.borderColor === color
                        : element.color === color;
                    const isDarkColor = [
                      "#e11d48",
                      "#f97316",
                      "#059669",
                      "#2563eb",
                      "#7c3aed",
                      "#64748b",
                      "#000000",
                    ].includes(color);
                    return (
                      <button
                        key={color}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (
                            element.shapeType === "cartesian" ||
                            element.shapeType === "advanced-cartesian" ||
                            element.shapeType === "numberline" ||
                            element.shapeType === "line"
                          ) {
                            onUpdate({ borderColor: color });
                          } else {
                            onUpdate({ color });
                          }
                          setShowColorPicker(false);
                        }}
                        className={`w-5 h-5 rounded-full border relative transition-all hover:scale-120 cursor-pointer ${
                          isSelected
                            ? "ring-2 ring-blue-500 ring-offset-1 border-white scale-105"
                            : "border-slate-200"
                        }`}
                        style={{ backgroundColor: color }}
                        title={color}
                      >
                        {isSelected && (
                          <div
                            className={`absolute inset-0 m-auto w-1.5 h-1.5 rounded-full ${isDarkColor ? "bg-white" : "bg-slate-800"}`}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {canWrite && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="p-1.5 rounded-lg hover:bg-rose-50 text-rose-500 hover:text-rose-600 transition-colors flex items-center space-x-1.5 text-xs font-bold"
              title="Delete shape"
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete</span>
            </button>
          )}
        </div>
      )}

      {/* Inline Reaction Badges (collapsible below) */}
      <div
        onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
        className="absolute -bottom-6 left-2 flex flex-wrap gap-1 z-10"
      >
        {Object.entries(element.reactions || {}).map(([emoji, users]) => (
          <button
            key={emoji}
            onClick={(e) => handleEmojiClick(emoji, e)}
            className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-bold bg-white border border-slate-200 shadow-sm transition-transform hover:scale-115 ${
              users.includes(currentUser.name)
                ? "bg-blue-50 border-blue-200 text-blue-900"
                : "text-slate-600"
            }`}
            title={users.join(", ")}
          >
            <span>{emoji}</span>
            <span className="text-[9px] ml-0.5 font-bold opacity-80">
              {users.length}
            </span>
          </button>
        ))}
      </div>

      {/* Resize handle */}
      {isSelected && canWrite && !element.locked && (
        <div
          className="absolute -bottom-2 -right-2 w-8 h-8 cursor-se-resize flex items-center justify-center pointer-events-auto z-20"
          onPointerDown={(e) => {
            e.stopPropagation();
            const canvasEvent = new CustomEvent("init-resize", {
              detail: {
                elementId: element.id,
                originalEvent: { clientX: e.clientX, clientY: e.clientY },
              },
            });
            window.dispatchEvent(canvasEvent);
          }}
        >
          <div className="w-2.5 h-2.5 rounded-full bg-blue-600 border border-white shadow-sm" />
        </div>
      )}

      {/* Advanced Cartesian Objects Panel */}
      {isSelected && canWrite && element.shapeType === "advanced-cartesian" && (
        <div
          onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
          className="absolute right-full top-0 mr-4 bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-2xl shadow-xl p-4 w-[240px] z-30 pointer-events-auto animate-scale-up flex flex-col space-y-4 text-left select-text max-h-[80vh] overflow-y-auto"
        >
          <div className="flex items-center space-x-2 pb-2 border-b border-slate-100">
            <div className="p-1.5 bg-blue-50 text-blue-600 rounded-lg">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h4 className="font-semibold text-xs text-slate-800">
                Objects
              </h4>
              <p className="text-[10px] text-slate-400">
                Plotted elements
              </p>
            </div>
          </div>
          
          <div className="flex flex-col space-y-4">
            {/* Equations */}
            <div className="flex flex-col space-y-2">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Equations</span>
              {element.equation && (
                <div className="flex items-center justify-between text-xs text-slate-700 bg-slate-50 px-2 py-1.5 rounded border border-slate-100">
                  <span className="truncate pr-2 flex items-center space-x-1">
                    <span className="text-indigo-500 font-mono font-medium text-[11px]">y1:</span>
                    <span className="font-serif italic text-indigo-950 font-medium">{formatMathDisplay(element.equation)}</span>
                  </span>
                  <button onClick={() => {
                    setEquationInput("");
                    onUpdate({ equation: "", equationMin: "", equationMax: "" });
                  }} className="text-slate-400 hover:text-red-500 flex-shrink-0 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              {element.equations?.map((eq, i) => (
                <div key={eq.id} className="flex items-center justify-between text-xs text-slate-700 bg-slate-50 px-2 py-1.5 rounded border border-slate-100">
                  <span className="truncate pr-2 flex items-center space-x-1">
                    <span className="font-mono font-medium text-[11px]" style={{ color: eq.color }}>y{i+2}:</span>
                    <span className="font-serif italic text-slate-900 font-medium">{formatMathDisplay(eq.expr)}</span>
                  </span>
                  <button onClick={() => {
                    const newEqs = element.equations?.filter(e => e.id !== eq.id);
                    onUpdate({ equations: newEqs });
                  }} className="text-slate-400 hover:text-red-500 flex-shrink-0 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {!element.equation && (!element.equations || element.equations.length === 0) && (
                 <span className="text-[10px] text-slate-400 italic">No equations plotted.</span>
              )}
            </div>

            {/* Points */}
            <div className="flex flex-col space-y-2">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Points</span>
              {tempPointsList.map((pt, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs text-slate-700 bg-slate-50 px-2 py-1.5 rounded border border-slate-100">
                  <span className="font-mono truncate pr-2">({pt.x.toFixed(2)}, {pt.y.toFixed(2)})</span>
                  <button onClick={() => {
                    const newPts = tempPointsList.filter((_, i) => i !== idx);
                    setTempPointsList(newPts);
                    const ptsStr = newPts.map(p => `(${p.x.toFixed(2)},${p.y.toFixed(2)})`).join(", ");
                    onUpdate({ plottedPoints: ptsStr });
                  }} className="text-slate-400 hover:text-red-500 flex-shrink-0 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {tempPointsList.length === 0 && (
                <span className="text-[10px] text-slate-400 italic">No points plotted.</span>
              )}
            </div>

            {/* Lines */}
            <div className="flex flex-col space-y-2">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Lines</span>
              {tempLinesList.map((line, idx) => (
                <div key={line.id} className="flex items-center justify-between text-xs text-slate-700 bg-slate-50 px-2 py-1.5 rounded border border-slate-100">
                  <span className="font-mono text-[10px] truncate pr-2" title={`(${line.x1.toFixed(1)},${line.y1.toFixed(1)}) → (${line.x2.toFixed(1)},${line.y2.toFixed(1)})`}>
                    ({line.x1.toFixed(1)},{line.y1.toFixed(1)}) → ({line.x2.toFixed(1)},{line.y2.toFixed(1)})
                  </span>
                  <button onClick={() => {
                    const newLines = tempLinesList.filter(l => l.id !== line.id);
                    setTempLinesList(newLines);
                    onUpdate({ plottedLines: newLines });
                  }} className="text-slate-400 hover:text-red-500 flex-shrink-0 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {tempLinesList.length === 0 && (
                <span className="text-[10px] text-slate-400 italic">No lines plotted.</span>
              )}
            </div>
            
          </div>
        </div>
      )}

      {/* Advanced Cartesian Settings Panel (Mini Desmos) */}
      {isSelected && canWrite && element.shapeType === "advanced-cartesian" && (
        <div
          onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
          className="absolute left-full top-0 ml-4 bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-2xl shadow-xl p-3.5 w-[320px] z-30 pointer-events-auto animate-scale-up flex flex-col space-y-3 text-left select-text max-h-[85vh] overflow-y-auto"
        >
          {/* Header & Feature Tabs */}
          <div className="flex flex-col space-y-2 pb-2 border-b border-slate-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg">
                  <TrendingUp className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="font-bold text-xs text-slate-800">
                    Advanced Plotter
                  </h4>
                  <p className="text-[10px] text-slate-400">
                    Desmos Math Suite
                  </p>
                </div>
              </div>
              {/* Reset Pan / View */}
              <button
                onClick={() => {
                  setGraphPan({ x: 0, y: 0 });
                  onUpdate({ graphPanX: 0, graphPanY: 0 });
                }}
                className="px-2 py-1 text-[10px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-600 rounded transition-colors"
                title="Center Graph View"
              >
                Recenter
              </button>
            </div>

            {/* Tab Selector */}
            <div className="grid grid-cols-5 gap-1 bg-slate-100/80 p-1 rounded-lg text-[10px] font-bold text-slate-600">
              <button
                onClick={() => setDesmosActiveTab("eq")}
                className={`py-1 rounded text-center transition-colors ${
                  desmosActiveTab === "eq" ? "bg-white text-indigo-600 shadow-xs" : "hover:text-slate-900"
                }`}
              >
                Equations
              </button>
              <button
                onClick={() => setDesmosActiveTab("sliders")}
                className={`py-1 rounded text-center transition-colors ${
                  desmosActiveTab === "sliders" ? "bg-white text-indigo-600 shadow-xs" : "hover:text-slate-900"
                }`}
              >
                Sliders
              </button>
              <button
                onClick={() => setDesmosActiveTab("table")}
                className={`py-1 rounded text-center transition-colors ${
                  desmosActiveTab === "table" ? "bg-white text-indigo-600 shadow-xs" : "hover:text-slate-900"
                }`}
              >
                Table
              </button>
              <button
                onClick={() => setDesmosActiveTab("grid")}
                className={`py-1 rounded text-center transition-colors ${
                  desmosActiveTab === "grid" ? "bg-white text-indigo-600 shadow-xs" : "hover:text-slate-900"
                }`}
              >
                Grid
              </button>
              <button
                onClick={() => setDesmosActiveTab("inspection")}
                className={`py-1 rounded text-center transition-colors ${
                  desmosActiveTab === "inspection" ? "bg-white text-indigo-600 shadow-xs" : "hover:text-slate-900"
                }`}
              >
                Inspect
              </button>
            </div>
          </div>

          {/* TAB 1: EQUATIONS & INEQUALITIES & DERIVATIVES */}
          {desmosActiveTab === "eq" && (
            <div className="flex flex-col space-y-3">
              {/* Primary Equation */}
              <div className="flex flex-col space-y-1">
                <label className="text-[10px] font-extrabold text-indigo-500 uppercase tracking-wider flex items-center justify-between">
                  <span>
                    Equation / Inequality{" "}
                    <span className="text-indigo-400 font-normal lowercase">
                      (y1)
                    </span>
                  </span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={equationInput}
                    onChange={(e) => {
                      setEquationInput(e.target.value);
                      onUpdate({ equation: e.target.value });
                    }}
                    placeholder="y = a*x^2 + b*x + c, x^2 + y^2 = 16, or y > x^2 - 2"
                    className="w-full px-2.5 py-1.5 bg-slate-50 border border-indigo-200/60 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white text-indigo-700"
                  />
                </div>
                {equationInput && (
                  <div className="flex items-center space-x-1.5 mt-1 px-2.5 py-1 bg-indigo-50/60 border border-indigo-100 rounded-md text-xs">
                    <span className="text-[10px] font-sans font-bold text-indigo-400 uppercase tracking-wider">Preview:</span>
                    {formatMathDisplay(equationInput)}
                  </div>
                )}
                <div className="flex space-x-2 mt-1">
                  <div className="flex-1 flex items-center space-x-1">
                    <span className="text-[10px] text-slate-400">Min x:</span>
                    <input
                      type="text"
                      value={element.equationMin || ""}
                      onChange={(e) => onUpdate({ equationMin: e.target.value })}
                      placeholder="-∞"
                      className="w-full px-1.5 py-1 bg-slate-50 border border-slate-200 rounded text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="flex-1 flex items-center space-x-1">
                    <span className="text-[10px] text-slate-400">Max x:</span>
                    <input
                      type="text"
                      value={element.equationMax || ""}
                      onChange={(e) => onUpdate({ equationMax: e.target.value })}
                      placeholder="∞"
                      className="w-full px-1.5 py-1 bg-slate-50 border border-slate-200 rounded text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                {/* Additional Equations */}
                {equationsArray.map((eq, index) => (
                  <div key={eq.id || index} className="mt-2 pt-2 border-t border-slate-100">
                    <label
                      className="text-[10px] font-extrabold uppercase tracking-wider flex items-center justify-between mb-1"
                      style={{ color: eq.color }}
                    >
                      <span>
                        Equation{" "}
                        <span className="font-normal lowercase">
                          (y{index + 2})
                        </span>
                      </span>
                      <button
                        onClick={() => {
                          const newEqs = equationsArray.filter((_, i) => i !== index);
                          setEquationsArray(newEqs);
                          onUpdate({ equations: newEqs });
                        }}
                        className="text-slate-400 hover:text-red-500"
                      >
                        <X size={12} />
                      </button>
                    </label>
                    <input
                      type="text"
                      value={eq.expr}
                      onChange={(e) => {
                        const newEqs = [...equationsArray];
                        newEqs[index].expr = e.target.value;
                        setEquationsArray(newEqs);
                        onUpdate({ equations: newEqs });
                      }}
                      placeholder="sin(a * x)"
                      className="w-full px-2.5 py-1.5 bg-slate-50 border rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:bg-white"
                      style={{
                        color: eq.color,
                        borderColor: `${eq.color}50`,
                      }}
                    />
                  </div>
                ))}

                <button
                  onClick={() => {
                    const EQUATION_COLORS = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899"];
                    const usedColors = new Set(equationsArray.map((eq) => eq.color).concat(["#6366f1"]));
                    let nextColor = EQUATION_COLORS.find((c) => !usedColors.has(c)) || EQUATION_COLORS[equationsArray.length % EQUATION_COLORS.length];

                    const newEqs = [...equationsArray, { id: Math.random().toString(), expr: "", color: nextColor }];
                    setEquationsArray(newEqs);
                    onUpdate({ equations: newEqs });
                  }}
                  className="mt-2 text-[10px] font-bold text-indigo-500 bg-indigo-50/60 hover:bg-indigo-100 py-1.5 px-2 rounded flex items-center justify-center w-full transition-colors"
                >
                  <Plus size={12} className="mr-1" /> Add Equation
                </button>
              </div>

              {/* Live Derivative Toggle */}
              <div className="flex items-center justify-between p-2 bg-amber-50/60 border border-amber-200/60 rounded-xl">
                <div className="flex flex-col">
                  <span className="text-[11px] font-bold text-amber-900">
                    Live Derivative f'(x)
                  </span>
                  <span className="text-[9px] text-amber-700">
                    Plot dynamic tangent slope curve
                  </span>
                </div>
                <button
                  onClick={() => {
                    const val = !showDerivative;
                    setShowDerivative(val);
                    onUpdate({ cartesianShowDerivative: val });
                  }}
                  className={`w-9 h-5 rounded-full transition-colors relative ${
                    showDerivative ? "bg-amber-500" : "bg-slate-300"
                  }`}
                >
                  <div
                    className={`w-3.5 h-3.5 bg-white rounded-full absolute top-0.75 transition-transform ${
                      showDerivative ? "left-4.5" : "left-0.75"
                    }`}
                  />
                </button>
              </div>

              {/* Presets */}
              <div className="flex flex-col space-y-1">
                <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">
                  Presets
                </label>
                <div className="grid grid-cols-2 gap-1">
                  <button
                    onClick={() => {
                      setEquationInput("a * x^2 + b * x + c");
                      onUpdate({ equation: "a * x^2 + b * x + c" });
                    }}
                    className="bg-slate-100 hover:bg-indigo-100 hover:text-indigo-700 text-slate-700 text-[10px] py-1 px-1.5 rounded font-medium transition-colors text-left truncate"
                  >
                    Quadratic (a,b,c)
                  </button>
                  <button
                    onClick={() => {
                      setEquationInput("x^2 + y^2 = 16");
                      onUpdate({ equation: "x^2 + y^2 = 16" });
                    }}
                    className="bg-slate-100 hover:bg-indigo-100 hover:text-indigo-700 text-slate-700 text-[10px] py-1 px-1.5 rounded font-medium transition-colors text-left truncate"
                  >
                    Circle x²+y²=16
                  </button>
                  <button
                    onClick={() => {
                      setEquationInput("y > x^2 - 2");
                      onUpdate({ equation: "y > x^2 - 2" });
                    }}
                    className="bg-slate-100 hover:bg-indigo-100 hover:text-indigo-700 text-slate-700 text-[10px] py-1 px-1.5 rounded font-medium transition-colors text-left truncate"
                  >
                    Inequality Region
                  </button>
                  <button
                    onClick={() => {
                      setEquationInput("sin(a * x)");
                      onUpdate({ equation: "sin(a * x)" });
                    }}
                    className="bg-slate-100 hover:bg-indigo-100 hover:text-indigo-700 text-slate-700 text-[10px] py-1 px-1.5 rounded font-medium transition-colors text-left truncate"
                  >
                    Sine Wave sin(a*x)
                  </button>
                </div>
              </div>

              {/* Interactive Plotting Tools */}
              <div className="flex flex-col space-y-1">
                <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">
                  Canvas Tools
                </label>
                <div className="grid grid-cols-3 gap-1">
                  <button
                    onClick={() =>
                      setGraphInteractionMode(
                        graphInteractionMode === "move" ? "none" : "move"
                      )
                    }
                    className={`text-[10px] py-1 rounded font-medium transition-colors border ${
                      graphInteractionMode === "move"
                        ? "bg-blue-100 text-blue-700 border-blue-300 font-bold"
                        : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    Move
                  </button>
                  <button
                    onClick={() =>
                      setGraphInteractionMode(
                        graphInteractionMode === "point" ? "none" : "point"
                      )
                    }
                    className={`text-[10px] py-1 rounded font-medium transition-colors border ${
                      graphInteractionMode === "point"
                        ? "bg-indigo-100 text-indigo-700 border-indigo-300 font-bold"
                        : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    Point
                  </button>
                  <button
                    onClick={() => {
                      setGraphInteractionMode(
                        graphInteractionMode === "line" ? "none" : "line"
                      );
                      setLineStartPoint(null);
                    }}
                    className={`text-[10px] py-1 rounded font-medium transition-colors border ${
                      graphInteractionMode === "line"
                        ? "bg-emerald-100 text-emerald-700 border-emerald-300 font-bold"
                        : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    Line
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: INTERACTIVE VARIABLE SLIDERS & ANIMATIONS */}
          {desmosActiveTab === "sliders" && (
            <div className="flex flex-col space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">
                  Dynamic Variable Sliders
                </span>
                <button
                  onClick={() => {
                    const pool = ["a", "b", "c", "m", "k", "n", "p", "q"];
                    const unused = pool.find((v) => !activeVarsList.includes(v)) || `v${activeVarsList.length + 1}`;
                    setCustomAddedVars([...customAddedVars, unused]);
                    if (!cartesianVariables[unused]) {
                      const updated = {
                        ...cartesianVariables,
                        [unused]: { min: -10, max: 10, step: 0.1, val: 1 },
                      };
                      setCartesianVariables(updated);
                      onUpdate({ cartesianVariables: updated });
                    }
                  }}
                  className="px-2 py-0.5 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded text-[10px] font-bold transition-colors"
                >
                  + Add Slider
                </button>
              </div>

              {activeVarsList.length === 0 ? (
                <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl flex flex-col items-center justify-center text-center space-y-2">
                  <div className="p-2 bg-indigo-50 text-indigo-600 rounded-full">
                    <Sliders className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-bold text-slate-700">No Variables Inputted</span>
                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    Type variables like <code className="bg-slate-200/70 text-indigo-700 px-1 py-0.5 rounded font-mono font-bold">a</code>, <code className="bg-slate-200/70 text-indigo-700 px-1 py-0.5 rounded font-mono font-bold">b</code>, or <code className="bg-slate-200/70 text-indigo-700 px-1 py-0.5 rounded font-mono font-bold">m</code> directly into your equations (e.g. <code className="bg-slate-200/70 text-indigo-700 px-1 py-0.5 rounded font-mono font-bold">y = a*x^2 + b</code>) to automatically generate live sliders.
                  </p>
                  <button
                    onClick={() => {
                      const unused = "a";
                      setCustomAddedVars([...customAddedVars, unused]);
                      if (!cartesianVariables[unused]) {
                        const updated = {
                          ...cartesianVariables,
                          [unused]: { min: -10, max: 10, step: 0.1, val: 1 },
                        };
                        setCartesianVariables(updated);
                        onUpdate({ cartesianVariables: updated });
                      }
                    }}
                    className="mt-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[10px] rounded-lg shadow-xs transition-all"
                  >
                    + Add Variable Slider
                  </button>
                </div>
              ) : (
                activeVarsList.map((varName) => {
                  const varObj = cartesianVariables[varName] || { min: -10, max: 10, step: 0.1, val: 1 };
                  return (
                    <div key={varName} className="p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl flex flex-col space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono font-bold text-indigo-600">
                          {varName} = {varObj.val.toFixed(2)}
                        </span>
                        <div className="flex items-center space-x-1">
                          <button
                            onClick={() => {
                              const updated = {
                                ...cartesianVariables,
                                [varName]: { ...varObj, isAnimating: !varObj.isAnimating },
                              };
                              setCartesianVariables(updated);
                              onUpdate({ cartesianVariables: updated });
                            }}
                            className={`px-2 py-0.5 rounded text-[9px] font-bold transition-colors ${
                              varObj.isAnimating
                                ? "bg-emerald-500 text-white animate-pulse"
                                : "bg-slate-200 text-slate-700 hover:bg-slate-300"
                            }`}
                          >
                            {varObj.isAnimating ? "Pause" : "Play ▶"}
                          </button>
                          {customAddedVars.includes(varName) && !detectedVarNames.includes(varName) && (
                            <button
                              onClick={() => {
                                setCustomAddedVars(customAddedVars.filter((v) => v !== varName));
                                const updated = { ...cartesianVariables };
                                delete updated[varName];
                                setCartesianVariables(updated);
                                onUpdate({ cartesianVariables: updated });
                              }}
                              className="text-slate-400 hover:text-red-500 p-0.5"
                              title="Remove Slider"
                            >
                              <X size={12} />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Slider Control */}
                      <input
                        type="range"
                        min={varObj.min}
                        max={varObj.max}
                        step={varObj.step}
                        value={varObj.val}
                        onChange={(e) => {
                          const updated = {
                            ...cartesianVariables,
                            [varName]: { ...varObj, val: parseFloat(e.target.value) },
                          };
                          setCartesianVariables(updated);
                          onUpdate({ cartesianVariables: updated });
                        }}
                        className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                      />

                      {/* Range Config */}
                      <div className="flex space-x-2 text-[9px] text-slate-400 font-mono">
                        <div className="flex items-center space-x-1">
                          <span>min:</span>
                          <input
                            type="number"
                            value={varObj.min}
                            onChange={(e) => {
                              const updated = {
                                ...cartesianVariables,
                                [varName]: { ...varObj, min: parseFloat(e.target.value) || -10 },
                              };
                              setCartesianVariables(updated);
                              onUpdate({ cartesianVariables: updated });
                            }}
                            className="w-10 px-1 py-0.5 bg-white border border-slate-200 rounded"
                          />
                        </div>
                        <div className="flex items-center space-x-1">
                          <span>max:</span>
                          <input
                            type="number"
                            value={varObj.max}
                            onChange={(e) => {
                              const updated = {
                                ...cartesianVariables,
                                [varName]: { ...varObj, max: parseFloat(e.target.value) || 10 },
                              };
                              setCartesianVariables(updated);
                              onUpdate({ cartesianVariables: updated });
                            }}
                            className="w-10 px-1 py-0.5 bg-white border border-slate-200 rounded"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* TAB 3: DATA TABLES & LINEAR REGRESSION */}
          {desmosActiveTab === "table" && (
            <div className="flex flex-col space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">
                  x/y Data Points Table
                </span>
                <button
                  onClick={() => {
                    const newPts = [...tablePoints, { x: 0, y: 0 }];
                    setTablePoints(newPts);
                    onUpdate({ cartesianTablePoints: newPts });
                  }}
                  className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded text-[10px] font-bold hover:bg-indigo-100"
                >
                  + Add Row
                </button>
              </div>

              {/* Table Inputs */}
              <div className="bg-slate-50 border border-slate-200/80 rounded-xl overflow-hidden text-xs">
                <div className="grid grid-cols-3 bg-slate-100 font-bold px-2 py-1 text-slate-600 border-b border-slate-200">
                  <span>x1</span>
                  <span>y1</span>
                  <span className="text-right">Action</span>
                </div>
                {tablePoints.map((pt, idx) => (
                  <div key={idx} className="grid grid-cols-3 gap-1 px-2 py-1 items-center border-b border-slate-100 last:border-b-0">
                    <input
                      type="number"
                      value={pt.x}
                      onChange={(e) => {
                        const newPts = [...tablePoints];
                        newPts[idx].x = parseFloat(e.target.value) || 0;
                        setTablePoints(newPts);
                        onUpdate({ cartesianTablePoints: newPts });
                      }}
                      className="w-full px-1.5 py-0.5 bg-white border border-slate-200 rounded font-mono text-slate-800"
                    />
                    <input
                      type="number"
                      value={pt.y}
                      onChange={(e) => {
                        const newPts = [...tablePoints];
                        newPts[idx].y = parseFloat(e.target.value) || 0;
                        setTablePoints(newPts);
                        onUpdate({ cartesianTablePoints: newPts });
                      }}
                      className="w-full px-1.5 py-0.5 bg-white border border-slate-200 rounded font-mono text-slate-800"
                    />
                    <div className="text-right">
                      <button
                        onClick={() => {
                          const newPts = tablePoints.filter((_, i) => i !== idx);
                          setTablePoints(newPts);
                          onUpdate({ cartesianTablePoints: newPts });
                        }}
                        className="text-slate-400 hover:text-red-500"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Auto-Fit Linear Regression Toggle & Stats */}
              <div className="p-2.5 bg-emerald-50/70 border border-emerald-200/80 rounded-xl flex flex-col space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-900">
                    Auto-Fit Regression y ~ m*x + b
                  </span>
                  <button
                    onClick={() => {
                      const val = !showRegression;
                      setShowRegression(val);
                      onUpdate({ cartesianTableRegression: val });
                    }}
                    className={`w-9 h-5 rounded-full transition-colors relative ${
                      showRegression ? "bg-emerald-600" : "bg-slate-300"
                    }`}
                  >
                    <div
                      className={`w-3.5 h-3.5 bg-white rounded-full absolute top-0.75 transition-transform ${
                        showRegression ? "left-4.5" : "left-0.75"
                      }`}
                    />
                  </button>
                </div>

                {showRegression && tablePoints.length >= 2 && (() => {
                  const reg = calculateLinearRegression(tablePoints);
                  if (!reg) return <span className="text-[10px] text-emerald-700">Need distinct points.</span>;
                  return (
                    <div className="flex flex-col space-y-1 font-mono text-[10px] text-emerald-800 bg-white/80 p-2 rounded-lg border border-emerald-200/50">
                      <div><span className="font-bold">Model:</span> y = {reg.slope.toFixed(3)}x {reg.intercept >= 0 ? `+ ${reg.intercept.toFixed(3)}` : `- ${Math.abs(reg.intercept).toFixed(3)}`}</div>
                      <div><span className="font-bold">Slope (m):</span> {reg.slope.toFixed(4)}</div>
                      <div><span className="font-bold">R² score:</span> {(reg.rSquared * 100).toFixed(1)}%</div>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* TAB 4: GRID MODES & PI TICKS & RANGE */}
          {desmosActiveTab === "grid" && (
            <div className="flex flex-col space-y-3">
              {/* Grid Mode Selector */}
              <div className="flex flex-col space-y-1">
                <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">
                  Grid Style
                </label>
                <div className="grid grid-cols-3 gap-1 bg-slate-100 p-1 rounded-lg text-[10px] font-bold">
                  <button
                    onClick={() => {
                      setGridMode("cartesian");
                      onUpdate({ cartesianGridMode: "cartesian" });
                    }}
                    className={`py-1 rounded text-center transition-colors ${
                      gridMode === "cartesian" ? "bg-white text-indigo-600 shadow-xs" : "text-slate-600"
                    }`}
                  >
                    Cartesian
                  </button>
                  <button
                    onClick={() => {
                      setGridMode("polar");
                      onUpdate({ cartesianGridMode: "polar" });
                    }}
                    className={`py-1 rounded text-center transition-colors ${
                      gridMode === "polar" ? "bg-white text-indigo-600 shadow-xs" : "text-slate-600"
                    }`}
                  >
                    Polar
                  </button>
                  <button
                    onClick={() => {
                      setGridMode("isometric");
                      onUpdate({ cartesianGridMode: "isometric" });
                    }}
                    className={`py-1 rounded text-center transition-colors ${
                      gridMode === "isometric" ? "bg-white text-indigo-600 shadow-xs" : "text-slate-600"
                    }`}
                  >
                    Isometric
                  </button>
                </div>
              </div>

              {/* Pi Ticks Switch */}
              <div className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl">
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-slate-800">
                    Trig π Ticks
                  </span>
                  <span className="text-[9px] text-slate-500">
                    Label axes in terms of π fractions
                  </span>
                </div>
                <button
                  onClick={() => {
                    const val = !piTicks;
                    setPiTicks(val);
                    onUpdate({ cartesianPiTicks: val });
                  }}
                  className={`w-9 h-5 rounded-full transition-colors relative ${
                    piTicks ? "bg-indigo-600" : "bg-slate-300"
                  }`}
                >
                  <div
                    className={`w-3.5 h-3.5 bg-white rounded-full absolute top-0.75 transition-transform ${
                      piTicks ? "left-4.5" : "left-0.75"
                    }`}
                  />
                </button>
              </div>

              {/* Axis Range Slider */}
              <div className="flex flex-col space-y-1">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">
                    Axis Range
                  </label>
                  <span className="text-xs font-bold text-indigo-600 font-mono">
                    ±{rangeInput}
                  </span>
                </div>
                <input
                  type="range"
                  min="2"
                  max="20"
                  step="1"
                  value={rangeInput}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    setRangeInput(val);
                    onUpdate({ cartesianRange: val });
                  }}
                  className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
              </div>

              {/* Number Font Size */}
              <div className="flex flex-col space-y-1">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">
                    Font Size
                  </label>
                  <span className="text-xs font-bold text-indigo-600 font-mono">
                    {axisFontSize}px
                  </span>
                </div>
                <input
                  type="range"
                  min="6"
                  max="20"
                  step="1"
                  value={axisFontSize}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    setAxisFontSize(val);
                    onUpdate({ axisFontSize: val });
                  }}
                  className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
              </div>
            </div>
          )}

          {/* TAB 5: TANGENT & SLOPE INSPECTION PROBE */}
          {desmosActiveTab === "inspection" && (
            <div className="flex flex-col space-y-3">
              <div className="flex items-center justify-between p-2.5 bg-amber-50/70 border border-amber-200/80 rounded-xl">
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-amber-900">
                    Tangent & Slope Probe
                  </span>
                  <span className="text-[9px] text-amber-700">
                    Inspect instantaneous slope f'(x)
                  </span>
                </div>
                <button
                  onClick={() => {
                    const val = !showInspection;
                    setShowInspection(val);
                    onUpdate({ cartesianShowInspection: val });
                  }}
                  className={`w-9 h-5 rounded-full transition-colors relative ${
                    showInspection ? "bg-amber-500" : "bg-slate-300"
                  }`}
                >
                  <div
                    className={`w-3.5 h-3.5 bg-white rounded-full absolute top-0.75 transition-transform ${
                      showInspection ? "left-4.5" : "left-0.75"
                    }`}
                  />
                </button>
              </div>

              {showInspection && (
                <div className="flex flex-col space-y-2 p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-slate-700">
                      Probe x-location:
                    </span>
                    <span className="text-xs font-mono font-bold text-amber-600">
                      x = {inspectionX.toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-rangeInput}
                    max={rangeInput}
                    step={0.1}
                    value={inspectionX}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setInspectionX(val);
                      onUpdate({ cartesianInspectionX: val });
                    }}
                    className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-amber-500"
                  />

                  {/* Readout stats */}
                  {element.equation && (() => {
                    const parsed = parseInequality(element.equation);
                    const yVal = evaluateMathExpression(parsed.cleanExpr, inspectionX, cartesianVariables);
                    const yPlus = evaluateMathExpression(parsed.cleanExpr, inspectionX + 0.005, cartesianVariables);
                    const yMinus = evaluateMathExpression(parsed.cleanExpr, inspectionX - 0.005, cartesianVariables);

                    if (yVal !== null && yPlus !== null && yMinus !== null) {
                      const slope = (yPlus - yMinus) / 0.01;
                      return (
                        <div className="flex flex-col space-y-1 font-mono text-[10px] text-slate-700 bg-white p-2 rounded border border-slate-200/60 mt-1">
                          <div><span className="font-bold text-slate-500">Point:</span> ({inspectionX.toFixed(2)}, {yVal.toFixed(2)})</div>
                          <div><span className="font-bold text-amber-600">Slope m = f'(x):</span> {slope.toFixed(4)}</div>
                          <div><span className="font-bold text-indigo-600">Tangent:</span> y = {slope.toFixed(2)}x {yVal - slope * inspectionX >= 0 ? `+ ${(yVal - slope * inspectionX).toFixed(2)}` : `- ${Math.abs(yVal - slope * inspectionX).toFixed(2)}`}</div>
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
