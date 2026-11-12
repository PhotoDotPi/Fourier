export const truncate = (text: string, maxLength = 50) =>
  text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;

export const firstNonEmpty = (...values: Array<string | undefined>) =>
  values.map((value) => value?.trim()).find((value): value is string => Boolean(value));
