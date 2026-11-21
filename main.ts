// Entry driver for csv-reader-speed-01-run-20261121: the harness runs `node /bot/main.ts` (node22). It reads every
// case from /input/cases.json (a JSON array of {id, input}), answers each one alone with run() from solve.js, and
// writes /output/answers.json: a JSON array of the answers, one per case and in the cases' order. Outside a
// container MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in for /input and /output.
//
// The answers are stringified and written one case at a time, which leaves /output/answers.json byte for byte what
// JSON.stringify(answers) is while never holding the whole output string beside the whole answers array.

import { closeSync, openSync, readFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// V8's incremental marking off, set before solve.js is imported so all of its work runs under it.
setFlagsFromString('--no-incremental-marking');

const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as {
  run: (input: unknown) => unknown;
};

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8')) as {
  id: string;
  input: unknown;
}[];

const fd = openSync(join(OUTPUT_DIR, 'answers.json'), 'w');
try {
  writeSync(fd, '[');
  for (let i = 0; i < cases.length; i++) {
    if (i > 0) writeSync(fd, ',');
    writeSync(fd, JSON.stringify(run(cases[i]!.input)));
  }
  writeSync(fd, ']');
} finally {
  closeSync(fd);
}
