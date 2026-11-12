interface GetYouTubeIdOptions {
  fuzzy?: boolean;
}

const patterns = [
  /youtu\.be\/([^#&?]{11})/, // youtu.be/<id>
  /\?v=([^#&?]{11})/, // ?v=<id>
  /&v=([^#&?]{11})/, // &v=<id>
  /embed\/([^#&?]{11})/, // embed/<id>
  /\/v\/([^#&?]{11})/, // /v/<id>
];

const getYouTubeId = (url: string, opts: GetYouTubeIdOptions = { fuzzy: true }): string | null => {
  if (!/youtu\.?be/.test(url)) {
    return null;
  }

  for (const pattern of patterns) {
    const match = pattern.exec(url);
    if (match) {
      return match[1];
    }
  }

  if (opts.fuzzy) {
    const tokens = url.split(/[/&?=#.\s]/g);
    for (const token of tokens) {
      if (/^[^#&?]{11}$/.test(token)) {
        return token;
      }
    }
  }

  return null;
};

export default getYouTubeId;
