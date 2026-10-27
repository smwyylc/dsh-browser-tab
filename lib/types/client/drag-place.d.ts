/**
 * Drop-side geometry shared by both draggable surfaces: the horizontal strip
 * and the vertical favorites drawer inside the panel.
 *
 * Kept in its own module so the two cannot drift apart: the side the pointer
 * sits on is what decides whether the dragged item lands before or after the
 * hovered one — left/right for a row, top/bottom for a column.
 */
/**
 * Which half of the target the pointer sits in on a horizontal row.
 * @param event - the dragover/drop event, already targeting one item.
 * @returns 'before' for the left half, 'after' for the right half.
 */
export declare function placeFor(event: React.DragEvent<HTMLElement>): 'before' | 'after';
/**
 * Which half of the target the pointer sits in on a vertical column.
 * @param event - the dragover/drop event, already targeting one item.
 * @returns 'before' for the upper half, 'after' for the lower half.
 */
export declare function placeForVertical(event: React.DragEvent<HTMLElement>): 'before' | 'after';
