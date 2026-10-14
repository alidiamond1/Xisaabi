import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("neutralises formula-looking text but leaves numbers (incl. negative) alone", () => {
    expect(toCsv([["=1+1", "+x", "-x", "@x", "\tx", "ok", -5, 3, null]])).toBe("'=1+1,'+x,'-x,'@x,'\tx,ok,-5,3,");
  });
  it("still quotes commas and quotes", () => {
    expect(toCsv([['a,"b"']])).toBe('"a,""b"""');
  });
});
