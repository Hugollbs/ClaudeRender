import { describe, expect, it } from "vitest";
import { formatClock, formatCost, formatDuration, formatPercent, formatTokens } from "../src/client/format";

describe("formatDuration", () => {
  it("affiche les millisecondes sous la seconde", () => expect(formatDuration(450)).toBe("450 ms"));
  it("affiche les secondes", () => expect(formatDuration(12_000)).toBe("12s"));
  it("affiche minutes et secondes", () => expect(formatDuration(200_000)).toBe("3m20s"));
  it("affiche heures et minutes", () => expect(formatDuration(3_720_000)).toBe("1h02m"));
  it("gère 0 et les valeurs négatives", () => {
    expect(formatDuration(0)).toBe("0 ms");
    expect(formatDuration(-5)).toBe("0 ms");
  });
});

describe("formatClock", () => {
  it("mm:ss", () => expect(formatClock(65_000)).toBe("01:05"));
  it("avec heures", () => expect(formatClock(3_725_000)).toBe("1:02:05"));
});

describe("formatTokens", () => {
  it("sépare les milliers", () => expect(formatTokens(1234567)).toBe("1 234 567"));
  it("ne touche pas aux petits nombres", () => expect(formatTokens(999)).toBe("999"));
  it("gère 0", () => expect(formatTokens(0)).toBe("0"));
});

describe("formatCost", () => {
  it("2 décimales", () => expect(formatCost(1.234)).toBe("$1.23"));
  it("plus de décimales sous 1 cent", () => expect(formatCost(0.0034)).toBe("$0.0034"));
  it("zéro", () => expect(formatCost(0)).toBe("$0.00"));
});

describe("formatPercent", () => {
  it("arrondit", () => expect(formatPercent(1, 3)).toBe("33 %"));
  it("total nul", () => expect(formatPercent(1, 0)).toBe("0 %"));
});
