import { maxContextSnippetBytes } from "@laplace/contracts";

const maxLines = 24;

export type Chunk = {
  startByte: number;
  endByte: number;
  firstLine: number;
  lastLine: number;
  splitLine: number;
};

export function* chunkSource(bytes: Buffer): Generator<Chunk> {
  let startByte = 0;
  let firstLine = 1;
  let continued = false;
  do {
    let endByte = Math.min(startByte + maxContextSnippetBytes, bytes.length);
    let lastLine = firstLine;
    let lineStart = startByte;
    let lineEnd = bytes.indexOf(10, lineStart);
    while (lineEnd >= 0 && lineEnd < endByte) {
      lineStart = lineEnd + 1;
      if (lastLine - firstLine + 1 === maxLines || lineStart === endByte) {
        endByte = lineStart;
        break;
      }
      lastLine++;
      lineEnd = bytes.indexOf(10, lineStart);
    }

    const splitsEnd = endByte < bytes.length && bytes[endByte - 1] !== 10;
    if (splitsEnd) {
      if (lineStart > startByte) {
        endByte = lineStart;
        lastLine--;
      } else {
        while ((bytes[endByte]! & 0xc0) === 0x80) endByte--;
        if (bytes[endByte] === 10 && bytes[endByte - 1] === 13) endByte--;
      }
    }

    const continues = endByte < bytes.length && bytes[endByte - 1] !== 10;
    yield {
      startByte,
      endByte,
      firstLine,
      lastLine,
      splitLine: Number(continued || continues),
    };
    startByte = endByte;
    firstLine = lastLine + (continues ? 0 : 1);
    continued = continues;
  } while (startByte < bytes.length);
}
