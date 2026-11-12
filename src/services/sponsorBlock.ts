export class ResponseError extends Error {
  readonly status: number;

  constructor(status: number, message?: string) {
    super(message ?? `[SponsorBlock] Status code not 200 (${status})`);
    this.name = 'ResponseError';
    this.status = status;
  }
}

export interface SponsorSegment {
  UUID?: string;
  startTime: number;
  endTime: number;
  category: string;
  videoDuration?: number;
}

interface SponsorBlockOptions {
  baseURL?: string;
  service?: string;
  userAgent?: string;
}

const defaultOptions = {
  baseURL: 'https://sponsor.ajay.app',
  service: 'YouTube',
  userAgent: 'node-sponsorblock',
};

const resolveVideo = (video: string | { videoID?: string }): string => {
  if (typeof video === 'string') {
    return video;
  }

  if (video && typeof video.videoID === 'string') {
    return video.videoID;
  }

  throw new Error('Invalid video identifier');
};

const statusMessage = (status: number): string => {
  const messages: Record<number, string> = {
    400: 'Bad Request (Your inputs are wrong/impossible)',
    403: 'Rejected by auto moderator',
    404: 'Not Found',
    405: 'Duplicate',
    409: 'Duplicate',
    429: 'Rate Limit (Too many for the same user or IP)',
  };

  return messages[status] ?? `Status code not 200 (${status})`;
};

export class SponsorBlock {
  private readonly options: Required<SponsorBlockOptions>;

  constructor(options: SponsorBlockOptions = {}) {
    this.options = {
      baseURL: (options.baseURL ?? defaultOptions.baseURL).replace(/\/$/, ''),
      service: options.service ?? defaultOptions.service,
      userAgent: options.userAgent ?? defaultOptions.userAgent,
    };
  }

  async getSegments(
    video: string | { videoID?: string },
    categories: string[] = ['sponsor'],
    ...requiredSegments: string[]
  ): Promise<SponsorSegment[]> {
    const videoID = resolveVideo(video);
    const params = new URLSearchParams();
    params.set('videoID', videoID);
    params.set('service', this.options.service);
    params.set('categories', JSON.stringify(categories));

    if (requiredSegments.length > 0) {
      params.set('requiredSegments', JSON.stringify(requiredSegments));
    }

    // Outbound request targets the fixed SponsorBlock API host.
    const response = await fetch(`${this.options.baseURL}/api/skipSegments?${params.toString()}`, {
      headers: { 'User-Agent': this.options.userAgent },
    });

    if (response.status !== 200) {
      throw new ResponseError(response.status, `[SponsorBlock] ${statusMessage(response.status)}`);
    }

    const data = (await response.json()) as Array<{
      UUID?: string;
      segment: [number, number];
      category: string;
      videoDuration?: number;
    }>;

    return data.map(({ UUID, segment, category, videoDuration }) => ({
      UUID,
      startTime: segment[0],
      endTime: segment[1],
      category,
      videoDuration,
    }));
  }
}
