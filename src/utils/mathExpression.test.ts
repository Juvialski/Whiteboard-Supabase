import { describe, expect, it } from 'vitest';
import { evaluateSafeMathExpression, parseGraphRelation } from './mathExpression';

describe('evaluateSafeMathExpression', () => {
  it('supports algebra, exponents, implicit multiplication, and variables', () => {
    expect(evaluateSafeMathExpression('2x^2 + 3x - 1', { x: 2 })).toBe(13);
    expect(evaluateSafeMathExpression('(x+1)(x-1)', { x: 3 })).toBe(8);
    expect(evaluateSafeMathExpression('a*x^2+b', { x: 2, a: 3, b: 1 })).toBe(13);
  });

  it('supports common functions and constants', () => {
    expect(evaluateSafeMathExpression('sin(pi/2)')).toBeCloseTo(1);
    expect(evaluateSafeMathExpression('sqrt(16)+log(100)')).toBeCloseTo(6);
    expect(evaluateSafeMathExpression('min(5,2)+max(1,4)')).toBe(6);
  });

  it('uses mathematical exponent precedence and right associativity', () => {
    expect(evaluateSafeMathExpression('-2^2')).toBe(-4);
    expect(evaluateSafeMathExpression('2^3^2')).toBe(512);
    expect(evaluateSafeMathExpression('2^-2')).toBeCloseTo(0.25);
  });

  it('rejects unknown identifiers, property access, and executable JavaScript', () => {
    expect(evaluateSafeMathExpression('window.alert(1)')).toBeNull();
    expect(evaluateSafeMathExpression('constructor.constructor(1)')).toBeNull();
    expect(evaluateSafeMathExpression('globalThis["fetch"]()')).toBeNull();
    expect(evaluateSafeMathExpression('x;alert(1)', { x: 1 })).toBeNull();
  });
});

describe('parseGraphRelation', () => {
  it('normalizes explicit y and f(x) equations', () => {
    expect(parseGraphRelation('y = 2x + 1').cleanExpr).toBe('2x + 1');
    expect(parseGraphRelation('f(x)=sin(x)').cleanExpr).toBe('sin(x)');
  });

  it('supports ASCII, Unicode, and LaTeX inequalities', () => {
    expect(parseGraphRelation('y <= 2x + 1')).toMatchObject({ op: '<=', cleanExpr: '2x + 1' });
    expect(parseGraphRelation('y ≤ x^2')).toMatchObject({ op: '<=', cleanExpr: 'x^2' });
    expect(parseGraphRelation(String.raw`y \ge x - 4`)).toMatchObject({ op: '>=', cleanExpr: 'x - 4' });
    expect(parseGraphRelation(String.raw`f(x) \leq sin(x)`)).toMatchObject({ op: '<=', cleanExpr: 'sin(x)' });
  });

  it('reverses the operator when y is on the right side', () => {
    expect(parseGraphRelation('2x + 1 >= y')).toMatchObject({ op: '<=', cleanExpr: '2x + 1' });
    expect(parseGraphRelation('x < y')).toMatchObject({ op: '>', cleanExpr: 'x' });
  });
});
