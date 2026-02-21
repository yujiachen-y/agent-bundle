type QueueResolver<T> = (result: IteratorResult<T>) => void;

export class AsyncEventQueue<T> implements AsyncIterable<T>, AsyncIterator<T> {
  private readonly items: T[] = [];
  private readonly resolvers: QueueResolver<T>[] = [];
  private closed = false;

  public push(item: T): void {
    const nextResolver = this.resolvers.shift();
    if (nextResolver) {
      nextResolver({ done: false, value: item });
      return;
    }

    this.items.push(item);
  }

  public close(): void {
    this.closed = true;
    let nextResolver = this.resolvers.shift();
    while (nextResolver) {
      nextResolver({ done: true, value: undefined });
      nextResolver = this.resolvers.shift();
    }
  }

  public async next(): Promise<IteratorResult<T>> {
    const nextItem = this.items.shift();
    if (nextItem !== undefined) {
      return { done: false, value: nextItem };
    }

    if (this.closed) {
      return { done: true, value: undefined };
    }

    return await new Promise<IteratorResult<T>>((resolve) => {
      this.resolvers.push(resolve);
    });
  }

  public [Symbol.asyncIterator](): AsyncIterator<T> {
    return this;
  }
}
