import { describe, it, expect } from "bun:test";
import { dragShift } from "./dragShift";

const ROW = 54;
const shiftsOfFiveRows = (draggedIdx: number | null, dragOverIdx: number | null) =>
  [0, 1, 2, 3, 4].map((index) => dragShift(index, draggedIdx, dragOverIdx, ROW));

describe("dragShift", () => {
  it("slides the rows from the drop target to the dragged row down a place when a row is dragged up", () => {
    expect(shiftsOfFiveRows(3, 1)).toEqual([0, ROW, ROW, 0, 0]);
  });

  it("slides the rows after the dragged row, to the drop target, up a place when a row is dragged down", () => {
    expect(shiftsOfFiveRows(1, 3)).toEqual([0, 0, -ROW, -ROW, 0]);
  });

  it("leaves every row in place until the dragged row is over another one", () => {
    expect(shiftsOfFiveRows(null, null)).toEqual([0, 0, 0, 0, 0]);
    expect(shiftsOfFiveRows(2, null)).toEqual([0, 0, 0, 0, 0]);
    expect(shiftsOfFiveRows(2, 2)).toEqual([0, 0, 0, 0, 0]);
  });
});
