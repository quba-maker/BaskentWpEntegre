export class AITimeoutException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AITimeoutException';
  }
}

/**
 * Wraps an asynchronous AI call with a timeout guard.
 * @param promise The AI call promise.
 * @param timeoutMs Timeout in milliseconds (default: 45000ms / 45s).
 */
export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number = 45000): Promise<T> {
  let timeoutHandle: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new AITimeoutException(`AI Provider timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutHandle);
  });
}
