/**
 * @see [globToRegex, playwright/netUtils.ts]{@link https://github.com/microsoft/playwright/blob/76abb3a5be7cab43e97c49bac099d6eb7da9ef98/packages/playwright-core/src/common/netUtils.ts#L139}
 */
export default function globToRegex(glob: string): RegExp {
  const tokens = ['^'];
  let inGroup;
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    switch (c) {
      // escape-chars
      case '/':
      case '$':
      case '^':
      case '+':
      case '.':
      case '(':
      case ')':
      case '=':
      case '!':
      case '|':
        tokens.push(`\\${c}`);
        break;
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
        tokens.push(c);
    }
  }
  tokens.push('$');
  return new RegExp(tokens.join(''));
}
