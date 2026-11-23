import { describe, expect, it } from 'vitest';
import {
  describeQuantity,
  formatEuro,
  parsePrice,
  parseQuantity,
  percentChange,
  unitPrice,
} from '../src';

describe('parsePrice', () => {
  it.each([
    ['€ 1.049,99', 104999],
    ['1049.99', 104999],
    ['1049,99', 104999],
    ['12,-', 1200],
    ['12,–', 1200],
    ['€ 3,33', 333],
    ['1 049,50', 104950],
    ['1,049.99', 104999],
    ['EUR 19', 1900],
    [349, 34900],
  ])('parses %s', (input, cents) => {
    expect(parsePrice(input)).toBe(cents);
  });

  it('returns null for empty or invalid input', () => {
    expect(parsePrice('')).toBeNull();
    expect(parsePrice('gratis')).toBeNull();
    expect(parsePrice(null)).toBeNull();
  });
});

describe('formatEuro', () => {
  it('formats Dutch style', () => {
    expect(formatEuro(34900).replace(/\s/g, ' ')).toBe('€ 349');
    expect(formatEuro(14999).replace(/\s/g, ' ')).toBe('€ 149,99');
  });
  it('computes percentage change', () => {
    expect(percentChange(44900, 34900)).toBe(-22.3);
  });
});

describe('quantities', () => {
  it('parses single items', () => {
    expect(parseQuantity('Rexona Men Invisible Black + White deodorant spray 150 ml')).toEqual({
      packCount: 1,
      amount: 150,
      unit: 'ml',
    });
  });
  it('parses multipacks', () => {
    expect(parseQuantity('Rexona Men Invisible deospray 6 x 150ml')).toEqual({
      packCount: 6,
      amount: 150,
      unit: 'ml',
    });
    expect(parseQuantity('Douchegel 3-pack 250 ml').packCount).toBe(3);
  });
  it('converts litres and kilos', () => {
    expect(parseQuantity('Wasmiddel 1,5 l')).toEqual({ packCount: 1, amount: 1500, unit: 'ml' });
    expect(parseQuantity('Koffiebonen 1kg')).toEqual({ packCount: 1, amount: 1000, unit: 'g' });
  });
  it('falls back to pieces', () => {
    expect(parseQuantity('Sony WH-1000XM6')).toEqual({ packCount: 1, amount: 1, unit: 'piece' });
  });
  it('computes unit prices', () => {
    const six = parseQuantity('6 x 150 ml');
    expect(unitPrice(1995, six, 'piece')).toBe(333);
    expect(unitPrice(1995, six, 'per100')).toBe(222);
    expect(describeQuantity(six)).toBe('6 × 150 ml');
  });
});
