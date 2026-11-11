import SpotifyWebApi from 'spotify-web-api-node';
import debug from '../utils/debug.js';
import type Config from './config.js';

const retry = async <T>(
  fn: () => Promise<T>,
  retries: number,
  delayMs: number,
  onRetry: (attempt: number) => void,
): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      if (attempt < retries) {
        onRetry(attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
};

export default class ThirdParty {
  readonly spotify: SpotifyWebApi;

  private spotifyTokenTimerId?: ReturnType<typeof setTimeout>;

  constructor(config: Config) {
    this.spotify = new SpotifyWebApi({
      clientId: config.SPOTIFY_CLIENT_ID,
      clientSecret: config.SPOTIFY_CLIENT_SECRET,
    });

    void this.refreshSpotifyToken();
  }

  cleanup() {
    if (this.spotifyTokenTimerId) {
      clearTimeout(this.spotifyTokenTimerId);
    }
  }

  private async refreshSpotifyToken() {
    try {
      await retry(
        async () => {
          const auth = await this.spotify.clientCredentialsGrant();
          this.spotify.setAccessToken(auth.body.access_token);
          this.scheduleSpotifyTokenRefresh((auth.body.expires_in / 2) * 1000);
        },
        5,
        0,
        () => {},
      );
    } catch (error: unknown) {
      debug('Spotify token refresh failed: %O', error);
      this.scheduleSpotifyTokenRefresh(60_000);
    }
  }

  private scheduleSpotifyTokenRefresh(delay: number) {
    this.spotifyTokenTimerId = setTimeout(() => {
      void this.refreshSpotifyToken();
    }, delay);
  }
}
