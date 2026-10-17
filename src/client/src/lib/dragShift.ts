// How far a row slides while another is dragged over its list, to show the order a drop would make: the rows between
// the dragged row and the drop target move one place toward the dragged row's old spot, and the dragged row moves into
// the gap they leave at the drop target
export function dragShift(index: number, draggedIdx: number | null, dragOverIdx: number | null, rowSize: number): number {
  if (draggedIdx === null || dragOverIdx === null) return 0;
  if (index === draggedIdx) return (dragOverIdx - draggedIdx) * rowSize;
  if (dragOverIdx < draggedIdx) return index >= dragOverIdx && index < draggedIdx ? rowSize : 0;
  if (dragOverIdx > draggedIdx) return index > draggedIdx && index <= dragOverIdx ? -rowSize : 0;
  return 0;
}
