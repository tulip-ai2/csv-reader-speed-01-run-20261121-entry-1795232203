// solve.js: a fast drop-in for make.fun's csv-reader 1.0.0. run(input) returns, for {text, header}, exactly what
// csv-reader 1.0.0's readCsv returns: {columns, rows, errors}. Every broken-row rule of the reference is matched:
//   - a U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a quoted field runs to the next quote that is not doubled, "" inside it one quote, and each CRLF or lone CR
//     inside it one LF; what follows its closing quote, up to the next comma or line break, is appended as it
//     stands (quote_junk, when the field ends and kept something); a quote that never closes is a literal
//     character and the text after it is read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds the records after it, padded
//     (short_row, fields: its count) or cut (long_row, extra: the cut fields) to the first record's width;
//   - each error is {code, line, row}: line the 1-based line its record starts on (every LF, CRLF and lone CR
//     inside quotes counted), row its index in rows (null for the header), in the order met.
//
// It differs from the reference only in speed: fields are cut with slice() instead of being built a character at
// a time, and a quoted field's closing quote is found with the string's native search. Pure: no clock, no
// randomness, no locale, nothing kept from one call to the next.

/** How a field ended, as small ints: comma (the record goes on), a line break, or the end of the text. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** The reading of one CSV input, {text, header}: {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const len = text.length;
  let pos = 0;
  let line = 1;
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // Each reader leaves its field here: the value, how it ended, and whether it kept any character.
  let fVal = '';
  let fEnd = END;
  let fAdded = false;

  // Reads unquoted characters from start onto `value` up to the next comma or line break: a CR not followed by
  // LF is dropped (stray_cr). Leaves fVal, fEnd and fAdded.
  function readUnquoted(start, value) {
    let i = start;
    let seg = start;
    let appended = false;
    let end = END;
    let next = len;
    while (i < len) {
      const c = text.charCodeAt(i);
      if (c === 44) {
        end = COMMA;
        next = i + 1;
        break;
      }
      if (c === 10) {
        end = LINE_BREAK;
        next = i + 1;
        line++;
        break;
      }
      if (c === 13) {
        if (text.charCodeAt(i + 1) === 10) {
          end = LINE_BREAK;
          next = i + 2;
          line++;
          break;
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        if (i > seg) {
          value += text.slice(seg, i);
          appended = true;
        }
        seg = i + 1;
        i++;
        continue;
      }
      i++;
    }
    pos = next;
    if (appended) {
      fVal = value + text.slice(seg, i);
      fAdded = true;
    } else if (i > seg) {
      fVal = value === '' ? text.slice(seg, i) : value + text.slice(seg, i);
      fAdded = true;
    } else {
      fVal = value;
      fAdded = false;
    }
    fEnd = end;
  }

  // Reads a quoted field whose opening quote is at start. Leaves fVal, fEnd and fAdded.
  function readQuoted(start) {
    const open = start;
    const openLine = line;
    // The closing quote: the first quote whose follower is no quote (the reference's greedy scan: a quote
    // followed by any quote is one doubled quote, even when that follower would have closed the field).
    let close = -1;
    let doubled = false;
    for (let q = open + 1; ; ) {
      const f = text.indexOf('"', q);
      if (f === -1) break;
      if (text.charCodeAt(f + 1) === 34) {
        doubled = true;
        q = f + 2;
        continue;
      }
      close = f;
      break;
    }
    if (close === -1) {
      // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      readUnquoted(open + 1, '"');
      return;
    }
    const cs = open + 1;
    const crAt = text.indexOf('\r', cs);
    const hasCR = crAt !== -1 && crAt < close;
    let value;
    if (!doubled && !hasCR) {
      // Plain content: one slice, and the line count from the LFs alone.
      value = text.slice(cs, close);
      let ln = 0;
      for (let p = cs; ; ) {
        const n = text.indexOf('\n', p);
        if (n === -1 || n >= close) break;
        ln++;
        p = n + 1;
      }
      if (ln > 0) line += ln;
    } else {
      // Doubled quotes and/or CRs: walk the span, each CRLF or lone CR one LF, each "" one quote.
      let i = cs;
      let seg = cs;
      let acc = null;
      while (i < close) {
        const c = text.charCodeAt(i);
        if (c === 34) {
          const piece = text.slice(seg, i);
          acc = acc === null ? piece + '"' : acc + piece + '"';
          seg = i + 2;
          i += 2;
          continue;
        }
        if (c === 13) {
          const piece = text.slice(seg, i);
          acc = acc === null ? piece + '\n' : acc + piece + '\n';
          line++;
          if (text.charCodeAt(i + 1) === 10) {
            seg = i + 2;
            i += 2;
          } else {
            seg = i + 1;
            i++;
          }
          continue;
        }
        if (c === 10) line++;
        i++;
      }
      const piece = text.slice(seg, close);
      value = acc === null ? piece : acc + piece;
    }
    const after = close + 1;
    if (after >= len) {
      pos = len;
      fVal = value;
      fEnd = END;
      fAdded = false;
      return;
    }
    const c = text.charCodeAt(after);
    if (c === 44) {
      pos = after + 1;
      fVal = value;
      fEnd = COMMA;
      fAdded = false;
      return;
    }
    if (c === 10) {
      pos = after + 1;
      line++;
      fVal = value;
      fEnd = LINE_BREAK;
      fAdded = false;
      return;
    }
    if (c === 13 && text.charCodeAt(after + 1) === 10) {
      pos = after + 2;
      line++;
      fVal = value;
      fEnd = LINE_BREAK;
      fAdded = false;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the next comma or line break.
    readUnquoted(after, value);
    if (fAdded) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos++;
        line++;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line++;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      if (quoted) readQuoted(pos);
      else readUnquoted(pos, '');
      fields.push(fVal);
    } while (fEnd === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    const n = fields.length;
    if (n < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: n });
      for (let k = n; k < width; k++) fields.push('');
    } else if (n > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
