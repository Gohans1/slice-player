// How far a row slides while another is dragged over its list, to open a gap where the dragged row would land: the
// rows between the drop target and the dragged row move one place toward the dragged row's old spot
export function dragShift(index: number, draggedIdx: number | null, dragOverIdx: number | null, rowSize: number): number {
  if (draggedIdx === null || dragOverIdx === null) return 0;
  if (dragOverIdx < draggedIdx) return index >= dragOverIdx && index < draggedIdx ? rowSize : 0;
  if (dragOverIdx > draggedIdx) return index > draggedIdx && index <= dragOverIdx ? -rowSize : 0;
  return 0;
}
