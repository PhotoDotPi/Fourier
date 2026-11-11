export const chunk = <T>(arr: T[], len: number) => {
  const chunks: T[][] = [];

  for (let i = 0; i < arr.length; i += len) {
    chunks.push(arr.slice(i, i + len));
  }

  return chunks;
};

export const shuffle = <T>(arr: T[]): T[] => {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};
