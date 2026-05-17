import { TelemetryPayload } from '../taxonomy';

export interface TelemetryTransport {
  /**
   * Dispatch the telemetry payload.
   * This must be implemented as a fire-and-forget or internally handled async process.
   * It should never throw an error that bubbles up to the caller.
   */
  dispatch(payload: TelemetryPayload): void | Promise<void>;
}
