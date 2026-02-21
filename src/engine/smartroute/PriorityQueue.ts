export class PriorityQueue<T> {
  private items: { item: T; priority: number }[] = []

  enqueue(item: T, priority: number) {
    this.items.push({ item, priority })
    this.items.sort((a, b) => a.priority - b.priority)
  }

  dequeue(): T | undefined {
    return this.items.shift()?.item
  }

  isEmpty() {
    return this.items.length === 0
  }
}
