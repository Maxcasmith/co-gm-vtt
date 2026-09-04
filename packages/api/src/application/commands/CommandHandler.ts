export interface CommandHandler<C, R> {
  handle: (command: C) => Promise<R>;
}
