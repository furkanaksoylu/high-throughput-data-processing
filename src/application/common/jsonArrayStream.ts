import { Readable } from 'node:stream';
import { parser } from 'stream-json';
import { streamArray } from 'stream-json/streamers/StreamArray';
import { chain } from 'stream-chain';

export async function* streamJsonArray(
  input: Readable,
): AsyncGenerator<unknown> {
  const pipeline = chain([input, parser(), streamArray()]);

  for await (const { value } of pipeline) {
    yield value;
  }
}
