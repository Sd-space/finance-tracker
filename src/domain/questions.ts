export function sanitizeToolInput<T>(input: T): T {
  if (input === undefined || input === null) {
    return input;
  }

  const serialized = JSON.stringify(input);
  if (serialized === undefined) {
    return input;
  }

  return JSON.parse(serialized) as T;
}
