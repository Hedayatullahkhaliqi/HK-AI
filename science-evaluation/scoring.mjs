export function compilePattern(source) {
  if (typeof source !== "string" || source[0] !== "/") {
    throw new TypeError("Invalid evaluation regex pattern");
  }
  const separator = source.lastIndexOf("/");
  if (separator <= 0) throw new TypeError("Invalid evaluation regex delimiter");
  return new RegExp(source.slice(1, separator), source.slice(separator + 1));
}

export function scoreScienceAnswer(item, reply, minimumCaseScore = 0.6, error = "") {
  const required = item.required.map(compilePattern);
  const forbidden = item.forbidden.map(compilePattern);
  const text = String(reply || "");
  const requiredPassed = required.filter(pattern => pattern.test(text)).length;
  const forbiddenPassed = forbidden.filter(pattern => !pattern.test(text)).length;
  const requiredScore = required.length ? requiredPassed / required.length : 1;
  const forbiddenScore = forbidden.length ? forbiddenPassed / forbidden.length : 1;
  const score = (requiredScore * 0.8) + (forbiddenScore * 0.2);
  return {
    passed: !error && score >= minimumCaseScore && forbiddenPassed === forbidden.length,
    score: Number(score.toFixed(2)),
    required: required.length,
    required_passed: requiredPassed,
    forbidden: forbidden.length,
    forbidden_passed: forbiddenPassed
  };
}
