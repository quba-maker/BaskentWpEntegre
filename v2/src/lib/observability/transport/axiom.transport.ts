import { TelemetryPayload } from '../taxonomy';
import { TelemetryTransport } from './types';

export class AxiomTransport implements TelemetryTransport {
  private url: string | undefined;
  private token: string | undefined;

  constructor() {
    this.url = process.env.AXIOM_URL || process.env.NEXT_PUBLIC_AXIOM_URL;
    this.token = process.env.AXIOM_TOKEN;
  }

  public dispatch(payload: TelemetryPayload): void {
    if (!this.url || !this.token) return;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1000); // 1s bounded timeout

      // Fire and forget. We deliberately do NOT await this to prevent execution blocking.
      fetch(this.url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify([payload]),
        signal: controller.signal
      })
      .then(res => {
        clearTimeout(timeoutId);
        if (!res.ok) {
          console.error(`[AxiomTransport] Failed to dispatch telemetry: ${res.statusText}`);
        }
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        if (err.name !== 'AbortError') {
          console.error("[AxiomTransport] Error dispatching telemetry:", err);
        }
      });
    } catch (err) {
      console.error("[AxiomTransport] Synchronous failure during dispatch:", err);
    }
  }
}
