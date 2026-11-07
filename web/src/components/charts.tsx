import { useId } from "react";

const F = (v: number) => (Math.round(v * 1000) / 1000).toString();
const fmt = (v: number, money?: boolean) => money ? v.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) : v.toLocaleString("fr-FR");

export function Donut({ data, centerLabel, centerValue, money }: { data: { label: string; value: number; color: string }[]; centerLabel?: string; centerValue?: string; money?: boolean }) {
  const R = 46, C = 2 * Math.PI * R;
  const total = data.reduce((s, d) => s + d.value, 0);
  let offset = 0;
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 120 120" className="donut" role="img">
        <circle cx="60" cy="60" r={R} fill="none" stroke="var(--line)" strokeWidth="14" />
        {total > 0 && data.map((d, i) => {
          const len = (d.value / total) * C;
          const el = <circle key={i} cx="60" cy="60" r={R} fill="none" stroke={d.color} strokeWidth="14" strokeDasharray={`${F(len)} ${F(C - len)}`}
            strokeDashoffset={F(-offset)} transform="rotate(-90 60 60)" className="donut-seg" style={{ animationDelay: `${i * 120}ms` }}><title>{`${d.label} : ${fmt(d.value, money)}`}</title></circle>;
          offset += len; return el;
        })}
        <text x="60" y="57" textAnchor="middle" className="donut-total">{centerValue ?? fmt(total, money)}</text>
        <text x="60" y="73" textAnchor="middle" className="donut-label">{centerLabel}</text>
      </svg>
      <ul className="legend">
        {data.map((d, i) => <li key={i}><span className="dot" style={{ background: d.color }}></span>{d.label} <b>{fmt(d.value, money)}</b></li>)}
        {!data.length && <li className="muted">Aucune donnée</li>}
      </ul>
    </div>
  );
}

export function BarChart({ data, money, colorTop = "#21CDC0", colorBottom = "#14B1BB", W = 420, H = 200 }: { data: { label: string; value: number }[]; money?: boolean; colorTop?: string; colorBottom?: string; W?: number; H?: number }) {
  const id = useId().replace(/:/g, "");
  const max = Math.max(1, ...data.map((d) => d.value)), n = Math.max(1, data.length), slot = (W - 20) / n, bw = Math.min(42, slot * 0.6);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="bars" role="img">
      <defs><linearGradient id={"bg" + id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={colorTop} /><stop offset="100%" stopColor={colorBottom} /></linearGradient></defs>
      {[1, 2, 3].map((g) => { const gy = H - 30 - ((H - 54) * g) / 3; return <line key={g} x1="10" x2={W - 10} y1={F(gy)} y2={F(gy)} className="grid" />; })}
      {data.map((d, i) => {
        const h = ((H - 54) * d.value) / max, x = 10 + slot * i + (slot - bw) / 2, y = H - 30 - h;
        return (
          <g key={i} className="bar" style={{ animationDelay: `${i * 70}ms` }}>
            {d.value > 0 && <g>
              <rect x={F(x)} y={F(y)} width={F(bw)} height={F(Math.max(h, 2))} rx="4" fill={`url(#bg${id})`}><title>{`${d.label} : ${fmt(d.value, money)}`}</title></rect>
              <text x={F(x + bw / 2)} y={F(y - 5)} textAnchor="middle" className="bar-val">{fmt(d.value, money)}</text>
            </g>}
            <text x={F(x + bw / 2)} y={H - 12} textAnchor="middle" className="bar-lbl">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function Sparkline({ values, color = "#14B1BB", max, W = 300, H = 70 }: { values: number[]; color?: string; max?: number; W?: number; H?: number }) {
  const id = useId().replace(/:/g, "");
  if (values.length < 2) return <svg viewBox={`0 0 ${W} ${H}`} className="spark" />;
  const m = Math.max(max ?? Math.max(...values), 0.001), step = W / (values.length - 1);
  const line = values.map((v, i) => `${F(i * step)},${F(H - 4 - ((H - 8) * v) / m)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="spark" preserveAspectRatio="none" role="img">
      <defs><linearGradient id={"sg" + id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.12" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <polygon points={`0,${H} ${line} ${W},${H}`} fill={`url(#sg${id})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" className="spark-line" />
    </svg>
  );
}
