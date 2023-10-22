export default function parseEvaluateExpression(expression: string): unknown {
  const exp = expression.trim();
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    return new Function(`return (${exp})`)();
  } catch {
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      return new Function(`return (${exp.replace(/^(async )?/, '$1function ')})`)();
    } catch {
      throw new Error('Passed function is not well-serializable!');
    }
  }
}
