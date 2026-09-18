export interface PickResult<T> {
  item: T;
  index: number;
}

/**
 * Weighted random picker with recency penalty (anti-repeat decay).
 *
 * Items played recently have their selection probability drastically reduced.
 * Over subsequent turns, their weight smoothly recovers back to 1.0.
 *
 * @param items Array of candidate items
 * @param getId Function extracting unique identifier for an item
 * @param history Map of item id -> turn number when it was last picked
 * @param currentTurn Monotonically increasing turn counter
 */
export function pickSmartRandomItem<T>(
  items: T[],
  getId: (item: T) => string,
  history: Map<string, number>,
  currentTurn: number
): PickResult<T> | null {
  const n = items.length;
  if (n === 0) return null;
  if (n === 1) return { item: items[0], index: 0 };

  // Dynamic cooldown window: proportional to playlist length, bounded between 2 and 30
  const cooldownWindow = Math.max(2, Math.min(30, Math.floor(n * 0.7)));

  // Calculate weights for each item
  const weights: number[] = new Array(n);
  let totalWeight = 0;

  for (let i = 0; i < n; i++) {
    const id = getId(items[i]);
    const lastPlayedTurn = history.get(id);

    let weight = 1.0;
    if (lastPlayedTurn !== undefined) {
      // Intervening turns since this item was last played (0 if played in immediate previous turn)
      const elapsedTurns = Math.max(0, currentTurn - lastPlayedTurn - 1);
      if (elapsedTurns === 0) {
        weight = 0;
      } else if (elapsedTurns < cooldownWindow) {
        // Quadratic decay: recent items are heavily penalized, recovering smoothly
        const ratio = elapsedTurns / cooldownWindow;
        weight = Math.max(0.02, ratio * ratio);
      }
    }

    weights[i] = weight;
    totalWeight += weight;
  }

  if (totalWeight <= 0) {
    const randomIndex = Math.floor(Math.random() * n);
    return { item: items[randomIndex], index: randomIndex };
  }

  // Pick index via subtraction-based distribution, strictly skipping zero-weight items
  let rand = Math.random() * totalWeight;
  for (let i = 0; i < n; i++) {
    if (weights[i] <= 0) continue;
    if (rand < weights[i]) {
      return { item: items[i], index: i };
    }
    rand -= weights[i];
  }

  // Fallback for float precision: find last valid item with positive weight
  for (let i = n - 1; i >= 0; i--) {
    if (weights[i] > 0) {
      return { item: items[i], index: i };
    }
  }

  return { item: items[0], index: 0 };
}
