import { TelemetryPayload } from '../taxonomy';
import { TelemetryTransport } from './types';

export class ConsoleTransport implements TelemetryTransport {
  dispatch(payload: TelemetryPayload): void {
    if (payload.status === "failure") {
      console.error(JSON.stringify(payload));
    } else if (payload.status === "warn") {
      console.warn(JSON.stringify(payload));
    } else {
      console.log(JSON.stringify(payload));
    }
  }
}
