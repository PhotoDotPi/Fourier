const getYouTubeSuggestionsFor = async (query: string): Promise<string[]> => {
  const url = new URL('https://suggestqueries.google.com/complete/search');
  url.searchParams.set('client', 'firefox');
  url.searchParams.set('ds', 'yt');
  url.searchParams.set('q', query);

  // Outbound request targets the fixed Google suggestion endpoint.
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`YouTube suggestions request failed (${response.status})`);
  }
  const data = (await response.json()) as [string, string[]];
  return data[1];
};

export default getYouTubeSuggestionsFor;
