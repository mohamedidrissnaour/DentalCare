import os from "node:os";
import { fmtDateTime } from "../../../shared/domain";

export interface Sample { at: string; cpuPercent: number; memoryMb: number; online: number; requests: number; avgLatencyMs: number }
export interface Online { id: string; userId: number; userName: string; role: string; connectedAt: string; lastSeen: string }

/** Indicateurs techniques en mémoire (supervision + /metrics au format Prometheus). */
class Metrics {
  startedAt = new Date();
  requests = 0; requests4xx = 0; requests5xx = 0;
  loginSuccess = 0; loginFailure = 0; rxSent = 0; rxPrinted = 0;
  queries = 0;
  private latSum = 0; private latCount = 0;
  history: Sample[] = [];
  routes = new Map<string, number>();
  online = new Map<string, Online>();
  private lastCpu = process.cpuUsage(); private lastAt = process.hrtime.bigint();

  track(route: string, status: number, ms: number) {
    this.requests++;
    if (status >= 500) this.requests5xx++; else if (status >= 400) this.requests4xx++;
    this.latSum += ms; this.latCount++;
    this.routes.set(route, (this.routes.get(route) ?? 0) + 1);
  }
  get avgLatencyMs() { return this.latCount ? this.latSum / this.latCount : 0; }

  sample() {
    const now = process.hrtime.bigint();
    const cpu = process.cpuUsage(this.lastCpu);
    const elapsedUs = Number(now - this.lastAt) / 1000;
    this.lastCpu = process.cpuUsage(); this.lastAt = now;
    const pct = elapsedUs > 0 ? Math.min(100, ((cpu.user + cpu.system) / elapsedUs / os.cpus().length) * 100) : 0;
    this.history.push({ at: fmtDateTime(new Date()), cpuPercent: +pct.toFixed(1), memoryMb: Math.round(process.memoryUsage().rss / 1048576), online: this.onlineUsers().length, requests: this.requests, avgLatencyMs: +this.avgLatencyMs.toFixed(1) });
    if (this.history.length > 120) this.history.shift();
  }

  onlineUsers(): Online[] {
    const seen = new Map<number, Online>();
    for (const o of this.online.values()) if (!seen.has(o.userId)) seen.set(o.userId, o);
    return [...seen.values()];
  }

  prometheus(dbBytes: number): string {
    const l = [
      ["dentacare_uptime_seconds", (Date.now() - this.startedAt.getTime()) / 1000],
      ["dentacare_http_requests_total", this.requests], ["dentacare_http_4xx_total", this.requests4xx], ["dentacare_http_5xx_total", this.requests5xx],
      ["dentacare_http_latency_ms_avg", this.avgLatencyMs], ["dentacare_login_success_total", this.loginSuccess], ["dentacare_login_failure_total", this.loginFailure],
      ["dentacare_prescriptions_sent_total", this.rxSent], ["dentacare_prescriptions_printed_total", this.rxPrinted],
      ["dentacare_online_users", this.onlineUsers().length], ["dentacare_memory_rss_bytes", process.memoryUsage().rss], ["dentacare_db_size_bytes", dbBytes],
    ];
    return l.map(([k, v]) => `${k} ${v}`).join("\n") + "\n";
  }
}
export const metrics = new Metrics();
