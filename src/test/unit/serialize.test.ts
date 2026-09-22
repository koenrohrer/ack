import { describe, it, expect } from 'vitest';
import { serialize } from '../../utils/serialize.js';

/** A promise plus the function that settles it, so a test controls timing. */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (err: Error) => void } {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('serialize', () => {
  it('does not start a second call until the first one settles', async () => {
    const events: string[] = [];
    const gates = [deferred(), deferred()];
    let call = 0;
    const run = serialize(async (label: string) => {
      const gate = gates[call++];
      events.push(`start ${label}`);
      await gate.promise;
      events.push(`end ${label}`);
    });

    const first = run('a');
    const second = run('b');
    await Promise.resolve();
    await Promise.resolve();

    expect(events).toEqual(['start a']);

    gates[0].resolve();
    await first;
    await Promise.resolve();
    expect(events).toEqual(['start a', 'end a', 'start b']);

    gates[1].resolve();
    await second;
    expect(events).toEqual(['start a', 'end a', 'start b', 'end b']);
  });

  it('rejects only the failing call and still runs the next one', async () => {
    const run = serialize(async (fail: boolean) => {
      if (fail) {
        throw new Error('boom');
      }
    });

    const failing = run(true);
    const next = run(false);

    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBeUndefined();
  });
});
