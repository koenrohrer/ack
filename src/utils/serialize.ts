/**
 * Wrap an async function so overlapping calls run one after another, in the
 * order they were made.
 *
 * Each call waits for every earlier call to settle before it starts. A call
 * that rejects rejects only its own caller's promise; the next call still
 * runs. Use it where two runs of the same work would race on shared state --
 * for example two profile switches toggling tools in the same config files.
 */
export function serialize<A extends unknown[]>(
  fn: (...args: A) => Promise<void>,
): (...args: A) => Promise<void> {
  let tail: Promise<void> = Promise.resolve();
  return (...args: A): Promise<void> => {
    const run = tail.then(() => fn(...args));
    tail = run.catch(() => undefined);
    return run;
  };
}
