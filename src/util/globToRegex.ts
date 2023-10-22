/**
 * Set of syntax characters used in regular expressions.
 *
 * [SyntaxCharacter, RegExp Patterns - ECMAScript Specification](https://tc39.es/ecma262/multipage/text-processing.html#prod-SyntaxCharacter)
 */
const syntaxChars = new Set(['^', '$', '\\', '.', '*', '+', '?', '(', ')', '[', ']', '{', '}', '|']);

/**
 * Functionally equivalent to Playwright's `globToRegex` function.
 *
 * [globToRegex, playwright/glob.ts - GitHub](https://github.com/microsoft/playwright/blob/d1d5fc67dc684a5d4b682749e59bba8cc0ad14de/packages/playwright-core/src/utils/glob.ts)
 */
export default function globToRegex(glob: string): RegExp {
  const tokens = ['^'];
  let inGroup = false;
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    switch (c) {
      case '\\': {
        i += 1;
        const char = i === glob.length ? c : glob[i + 1];
        tokens.push(syntaxChars.has(char) ? `\\${char}` : char);
        break;
      }
      case '*': {
        const beforeDeep = glob[i - 1];
        let starCount = 1;
        while (glob[i + 1] === '*') {
          starCount += 1;
          i += 1;
        }
        const afterDeep = glob[i + 1];
        const isDeep = starCount > 1
          && (beforeDeep === '/' || beforeDeep === undefined)
          && (afterDeep === '/' || afterDeep === undefined);
        if (isDeep) {
          tokens.push('((?:[^/]*(?:/|$))*)');
          i += 1;
        } else {
          tokens.push('([^/]*)');
        }
        break;
      }
      case '?':
        tokens.push('.');
        break;
      case '[':
      case ']':
        tokens.push(c);
        break;
      case '{':
        inGroup = true;
        tokens.push('(');
        break;
      case '}':
        inGroup = false;
        tokens.push(')');
        break;
      case ',':
        if (inGroup) {
          tokens.push('|');
          break;
        }
        tokens.push(`\\${c}`);
        break;
      default:
        tokens.push(syntaxChars.has(c) ? `\\${c}` : c);
    }
  }
  tokens.push('$');
  return new RegExp(tokens.join(''));
}
