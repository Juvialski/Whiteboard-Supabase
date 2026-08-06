export type MathVariableMap = Record<string, number>;

export type GraphRelationOperator = '<=' | '<' | '>=' | '>' | null;

export interface ParsedGraphRelation {
  isInequality: boolean;
  op: GraphRelationOperator;
  isStrict: boolean;
  cleanExpr: string;
}

function isGraphYSide(value: string): boolean {
  const compact = value.replace(/\s+/g, '');
  return compact === 'y' || compact === 'f(x)';
}

function reverseGraphOperator(operator: Exclude<GraphRelationOperator, null>): Exclude<GraphRelationOperator, null> {
  switch (operator) {
    case '<': return '>';
    case '<=': return '>=';
    case '>': return '<';
    case '>=': return '<=';
  }
}

/**
 * Parses explicit graph equations and y-based inequalities without evaluating
 * arbitrary JavaScript. It accepts ASCII, Unicode, and common LaTeX relation
 * operators, including reversed forms such as `2x + 1 >= y`.
 */
export function parseGraphRelation(expression: string): ParsedGraphRelation {
  const original = String(expression || '').trim();
  if (!original) {
    return { isInequality: false, op: null, isStrict: false, cleanExpr: '' };
  }

  const normalized = original
    .replace(/\\leq?/gi, '<=')
    .replace(/\\geq?/gi, '>=')
    .replace(/\\lt/gi, '<')
    .replace(/\\gt/gi, '>')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .trim();

  const relationMatch = normalized.match(/<=|>=|<|>/);
  if (relationMatch && relationMatch.index !== undefined) {
    const rawOperator = relationMatch[0] as Exclude<GraphRelationOperator, null>;
    const left = normalized.slice(0, relationMatch.index).trim();
    const right = normalized.slice(relationMatch.index + rawOperator.length).trim();
    if (!left || !right) {
      return { isInequality: false, op: null, isStrict: false, cleanExpr: original };
    }

    let op = rawOperator;
    let cleanExpr = right;
    if (isGraphYSide(right) && !isGraphYSide(left)) {
      op = reverseGraphOperator(rawOperator);
      cleanExpr = left;
    } else if (isGraphYSide(left)) {
      cleanExpr = right;
    }

    return {
      isInequality: true,
      op,
      isStrict: op === '<' || op === '>',
      cleanExpr: cleanExpr.trim(),
    };
  }

  const explicitMatch = normalized.match(/^\s*(?:y|f\s*\(\s*x\s*\))\s*=\s*(.+)$/i);
  return {
    isInequality: false,
    op: null,
    isStrict: false,
    cleanExpr: explicitMatch?.[1]?.trim() || normalized,
  };
}

type TokenType = 'number' | 'identifier' | 'operator' | 'leftParen' | 'rightParen' | 'comma' | 'eof';

interface Token {
  type: TokenType;
  value: string;
  numberValue?: number;
}

const CONSTANTS: MathVariableMap = {
  pi: Math.PI,
  e: Math.E,
};

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  sqrt: Math.sqrt,
  abs: Math.abs,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log10,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
  min: Math.min,
  max: Math.max,
  csc: (value) => 1 / Math.sin(value),
  sec: (value) => 1 / Math.cos(value),
  cot: (value) => 1 / Math.tan(value),
  rad: (value) => value * Math.PI / 180,
  deg: (value) => value * 180 / Math.PI,
};

class Lexer {
  private index = 0;

  constructor(private readonly input: string) {}

  next(): Token {
    while (this.index < this.input.length && /\s/.test(this.input[this.index])) this.index += 1;
    if (this.index >= this.input.length) return { type: 'eof', value: '' };

    const char = this.input[this.index];
    if (/[0-9.]/.test(char)) return this.readNumber();
    if (/[a-zA-Z_]/.test(char)) return this.readIdentifier();

    this.index += 1;
    if ('+-*/^'.includes(char)) return { type: 'operator', value: char };
    if (char === '(') return { type: 'leftParen', value: char };
    if (char === ')') return { type: 'rightParen', value: char };
    if (char === ',') return { type: 'comma', value: char };
    throw new Error(`Unsupported character: ${char}`);
  }

  private readNumber(): Token {
    const start = this.index;
    let sawDigit = false;
    let sawDot = false;

    while (this.index < this.input.length) {
      const char = this.input[this.index];
      if (/[0-9]/.test(char)) {
        sawDigit = true;
        this.index += 1;
        continue;
      }
      if (char === '.' && !sawDot) {
        sawDot = true;
        this.index += 1;
        continue;
      }
      break;
    }

    if (!sawDigit) throw new Error('Invalid number');

    if (/[eE]/.test(this.input[this.index] || '')) {
      const exponentStart = this.index;
      this.index += 1;
      if (/[+-]/.test(this.input[this.index] || '')) this.index += 1;
      const digitStart = this.index;
      while (/[0-9]/.test(this.input[this.index] || '')) this.index += 1;
      if (digitStart === this.index) this.index = exponentStart;
    }

    const value = this.input.slice(start, this.index);
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) throw new Error('Invalid number');
    return { type: 'number', value, numberValue };
  }

  private readIdentifier(): Token {
    const start = this.index;
    while (this.index < this.input.length && /[a-zA-Z0-9_]/.test(this.input[this.index])) {
      this.index += 1;
    }
    return { type: 'identifier', value: this.input.slice(start, this.index).toLowerCase() };
  }
}

class Parser {
  private current: Token;

  constructor(
    private readonly lexer: Lexer,
    private readonly variables: MathVariableMap
  ) {
    this.current = lexer.next();
  }

  parse(): number {
    const value = this.parseAdditive();
    if (this.current.type !== 'eof') throw new Error(`Unexpected token: ${this.current.value}`);
    return value;
  }

  private advance(): Token {
    const previous = this.current;
    this.current = this.lexer.next();
    return previous;
  }

  private parseAdditive(): number {
    let value = this.parseMultiplicative();
    while (this.current.type === 'operator' && (this.current.value === '+' || this.current.value === '-')) {
      const operator = this.advance().value;
      const right = this.parseMultiplicative();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }

  private parseMultiplicative(): number {
    let value = this.parseUnary();
    while (true) {
      if (this.current.type === 'operator' && (this.current.value === '*' || this.current.value === '/')) {
        const operator = this.advance().value;
        const right = this.parseUnary();
        value = operator === '*' ? value * right : value / right;
        continue;
      }

      // Algebraic implicit multiplication: 2x, 3(x+1), (x+1)(x-1), 2sin(x).
      if (this.startsPrimary(this.current)) {
        value *= this.parseUnary();
        continue;
      }
      break;
    }
    return value;
  }

  private parseUnary(): number {
    if (this.current.type === 'operator' && (this.current.value === '+' || this.current.value === '-')) {
      const operator = this.advance().value;
      const value = this.parseUnary();
      return operator === '-' ? -value : value;
    }
    return this.parsePower();
  }

  private parsePower(): number {
    const base = this.parsePrimary();
    if (this.current.type === 'operator' && this.current.value === '^') {
      this.advance();
      return Math.pow(base, this.parseUnary());
    }
    return base;
  }

  private currentIs(type: TokenType): boolean {
    return this.current.type === type;
  }

  private parsePrimary(): number {
    if (this.current.type === 'number') {
      return this.advance().numberValue as number;
    }

    if (this.current.type === 'identifier') {
      const name = this.advance().value;
      const fn = FUNCTIONS[name];
      if (fn) {
        if (!this.currentIs('leftParen')) throw new Error(`${name} requires parentheses`);
        this.advance();
        const args: number[] = [];
        if (!this.currentIs('rightParen')) {
          args.push(this.parseAdditive());
          while (this.currentIs('comma')) {
            this.advance();
            args.push(this.parseAdditive());
          }
        }
        if (!this.currentIs('rightParen')) throw new Error('Missing closing parenthesis');
        this.advance();
        if (args.length === 0) throw new Error(`${name} requires an argument`);
        return fn(...args);
      }

      if (Object.prototype.hasOwnProperty.call(this.variables, name)) return this.variables[name];
      if (Object.prototype.hasOwnProperty.call(CONSTANTS, name)) return CONSTANTS[name];
      throw new Error(`Unknown variable: ${name}`);
    }

    if (this.current.type === 'leftParen') {
      this.advance();
      const value = this.parseAdditive();
      if (!this.currentIs('rightParen')) throw new Error('Missing closing parenthesis');
      this.advance();
      return value;
    }

    throw new Error(`Unexpected token: ${this.current.value || 'end of expression'}`);
  }

  private startsPrimary(token: Token): boolean {
    return token.type === 'number' || token.type === 'identifier' || token.type === 'leftParen';
  }
}

export function evaluateSafeMathExpression(
  expression: string,
  variables: MathVariableMap = {}
): number | null {
  try {
    const normalized = expression
      .trim()
      .toLowerCase()
      .replace(/π/g, 'pi')
      .replace(/[−–—]/g, '-')
      .replace(/×|·/g, '*')
      .replace(/÷/g, '/');
    if (!normalized || normalized.length > 500) return null;

    const safeVariables: MathVariableMap = {};
    for (const [name, value] of Object.entries(variables)) {
      const normalizedName = name.toLowerCase();
      if (/^[a-z_][a-z0-9_]*$/.test(normalizedName) && Number.isFinite(value)) {
        safeVariables[normalizedName] = value;
      }
    }

    const result = new Parser(new Lexer(normalized), safeVariables).parse();
    return Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}
