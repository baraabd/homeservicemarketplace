'use strict';

const { REGEX_BACKSLASH, REGEX_SPECIAL_CHARS, REGEX_SPECIAL_CHARS_GLOBAL } = require('./constants');

exports.isObject = (val) => val !== null && typeof val === 'object' && !Array.isArray(val);
exports.hasRegexChars = (str) => REGEX_SPECIAL_CHARS.test(str);
exports.isRegexChar = (str) => str.length === 1 && exports.hasRegexChars(str);
exports.escapeRegex = (str) => str.replace(REGEX_SPECIAL_CHARS_GLOBAL, '\\$1');
exports.toPosixSlashes = (str) => str.replace(REGEX_BACKSLASH, '/');

exports.isWindows = () => {
  if (typeof navigator !== 'undefined' && navigator.platform) {
    const platform = navigator.platform.toLowerCase();
    return platform === 'win32' || platform === 'windows';
  }

  if (typeof process !== 'undefined' && process.platform) {
    return process.platform === 'win32';
  }

  return false;
};

// Preserve bracket expressions while removing other escapes in linear time.
// The upstream lazy bracket regex retries every unmatched '[' and is quadratic.
exports.removeBackslashes = (str) => {
  const output = [];
  const isLineBreak = (char) =>
    char === '\n' || char === '\r' || char === '\u2028' || char === '\u2029';
  let index = 0;
  const appendUnescaped = (end) => {
    while (index < end) {
      const char = str[index];
      if (char !== '\\' || index + 1 === str.length || isLineBreak(str[index + 1])) {
        output.push(char);
      }
      index++;
    }
  };
  while (index < str.length) {
    if (str[index] !== '[') {
      appendUnescaped(index + 1);
      continue;
    }
    let end = index + 1;
    let closed = false;
    for (; end < str.length; end++) {
      if (str[end] === ']' && end > index + 1 && str[end - 1] !== '\\') {
        closed = true;
        break;
      }
      // Dot cannot cross a line break in the original expression, except when
      // the break itself is the final non-backslash character before ']'.
      if (isLineBreak(str[end]) && str[end + 1] !== ']') break;
    }
    if (closed) {
      output.push(str.slice(index, end + 1));
      index = end + 1;
    } else {
      // Every nested '[' before this boundary also lacks a valid closing ']'.
      // Consume the span once; do not retry its suffix at each opening bracket.
      appendUnescaped(end);
    }
  }
  return output.join('');
};

exports.escapeLast = (input, char, lastIdx) => {
  const idx = input.lastIndexOf(char, lastIdx);
  if (idx === -1) return input;
  if (input[idx - 1] === '\\') return exports.escapeLast(input, char, idx - 1);
  return `${input.slice(0, idx)}\\${input.slice(idx)}`;
};

exports.removePrefix = (input, state = {}) => {
  let output = input;
  if (output.startsWith('./')) {
    output = output.slice(2);
    state.prefix = './';
  }
  return output;
};

exports.wrapOutput = (input, state = {}, options = {}) => {
  const prepend = options.contains ? '' : '^';
  const append = options.contains ? '' : '$';

  let output = `${prepend}(?:${input})${append}`;
  if (state.negated === true) {
    output = `(?:^(?!${output}).*$)`;
  }
  return output;
};

exports.basename = (path, { windows } = {}) => {
  const segs = path.split(windows ? /[\\/]/ : '/');
  const last = segs[segs.length - 1];

  if (last === '') {
    return segs[segs.length - 2];
  }

  return last;
};
