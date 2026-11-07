import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useSession, useLive } from "../lib/session";
import { useApi } from "../lib/hooks";
import { qs } from "../lib/api";
import { Icon } from "../components/Icon";
import { PageLoader, PageHead } from "../components/ui";
import { AppointmentEditor } from "../components/AppointmentEditor";
import { AppointmentDetail } from "../components/AppointmentDetail";
import { rangesFor } from "../lib/hours";
import { P, isDoctor, apptIsActive, apptStatusCss, apptStatusLabel, fmtDay, fmtDateTime, parseDt, initials } from "../../../shared/domain";

const PX = 1.6;
const ALL = ["Planifie", "Confirme", "Arrive", "EnCours", "Termine", "Annule", "Absent"];
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export function Agenda() {
  const { me, can, ref } = useSession();
  const [params] = useSearchParams();
  const [day, setDay] = useState(() => parseDt(params.get("date")) ?? new Date());
  const [week, setWeek] = useState(false);
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<any>(null);
  const [editing, setEditing] = useState<any>(null);
  const weekStart = addDays(day, -((day.getDay() + 6) % 7));
  const from = week ? weekStart : new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const items = useApi<any[]>(`/appointments${qs({ from: fmtDay(from), to: fmtDay(addDays(from, week ? 6 : 1)) })}`);
  useLive(["appointments"], () => items.reload());

  const settings = ref?.settings;
  const [startHour, endHour] = useMemo(() => {
    const all = Array.from({ length: 7 }, (_, i) => rangesFor(settings, addDays(new Date(), i))).flat();
    if (!all.length) return [8, 20];
    return [Math.max(6, Math.floor(Math.min(...all.map((r) => r[0])) / 60)), Math.min(23, Math.ceil(Math.max(...all.map((r) => r[1])) / 60))];
  }, [settings]);

  const newAppt = (at?: Date | null, doctorId?: number | null, patientId?: number) => {
    let s = at ?? null;
    if (!s) {
      const n = new Date();
      s = fmtDay(day) !== fmtDay(n) ? new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9) : new Date(n.getFullYear(), n.getMonth(), n.getDate(), n.getHours(), (Math.floor(n.getMinutes() / 15) + 1) * 15);
    }
    setEditing({ id: 0, startAt: fmtDateTime(s), endAt: fmtDateTime(new Date(s.getTime() + 30 * 60000)), doctorId: doctorId ?? (me && isDoctor(me.role) ? me.id : 0), patientId: patientId ?? 0 });
  };
  useEffect(() => {
    if (params.get("nouveau") === "1" && can(P.AgendaEdit) && ref) newAppt(null, me && isDoctor(me.role) ? me.id : null, Number(params.get("patient")) || undefined);
  }, [ref]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!items.data || !ref) return <PageLoader text="Chargement de l'agenda…" />;
  const visible = items.data.filter((a) => !hidden.has(a.doctorId));
  const cols = week
    ? Array.from({ length: 6 }, (_, i) => { const d = addDays(weekStart, i); return { day: d, doctor: null as any, items: visible.filter((a) => a.startAt.slice(0, 10) === fmtDay(d)) }; })
    : ref.doctors.filter((d) => !hidden.has(d.id)).map((doc) => ({ day, doctor: doc, items: visible.filter((a) => a.doctorId === doc.id) }));
  const title = week ? `Semaine du ${weekStart.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} au ${addDays(weekStart, 5).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}`
    : day.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const rows = (endHour - startHour) * 4, todayStr = fmtDay(new Date()), now = new Date();
  const px = (v: number) => `${Math.round(v * 10) / 10}px`;

  return (
    <>
      <PageHead title="Agenda" sub={title}>
        <div className="seg"><button className={week ? "" : "on"} onClick={() => setWeek(false)}>Jour</button><button className={week ? "on" : ""} onClick={() => setWeek(true)}>Semaine</button></div>
        <div className="seg">
          <button onClick={() => setDay(addDays(day, week ? -7 : -1))} title="Précédent">◀</button>
          <button onClick={() => setDay(new Date())}>Aujourd'hui</button>
          <button onClick={() => setDay(addDays(day, week ? 7 : 1))} title="Suivant">▶</button>
        </div>
        <input type="date" value={fmtDay(day)} onChange={(e) => { const d = parseDt(e.target.value); if (d) setDay(d); }} aria-label="Aller à la date" />
        {can(P.AgendaEdit) && <button className="btn btn-primary" onClick={() => newAppt()}><Icon n="plus" /> Nouveau RDV</button>}
      </PageHead>
      <div className="doctor-filter">
        {ref.doctors.map((d) => (
          <button key={d.id} className={"doc-chip" + (hidden.has(d.id) ? " off" : "")} style={{ ["--c" as any]: d.color }}
            onClick={() => setHidden((h) => { const n = new Set(h); n.has(d.id) ? n.delete(d.id) : n.add(d.id); return n; })}>
            <span className="avatar sm" style={{ background: d.color }}>{initials(d.fullName)}</span> Dr {d.fullName}
          </button>
        ))}
      </div>
      <div className="calendar card" style={{ ["--cols" as any]: cols.length, ["--rows" as any]: rows }}>
        <div className="cal-head">
          <div className="cal-corner"></div>
          {cols.map((c, i) => {
            const closed = !rangesFor(settings, c.day).length;
            return (
              <div key={i} className={"cal-col-head" + (fmtDay(c.day) === todayStr ? " today" : "") + (closed ? " closed" : "")}>
                {c.doctor ? <><span className="avatar sm" style={{ background: c.doctor.color }}>{initials(c.doctor.fullName)}</span> <b>Dr {c.doctor.fullName}</b></>
                  : <b>{c.day.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" })}</b>}
                <small>{c.items.filter((a) => apptIsActive(a.status)).length} RDV</small>
              </div>
            );
          })}
        </div>
        <div className="cal-body">
          <div className="cal-hours">{Array.from({ length: endHour - startHour }, (_, i) => <div key={i} className="cal-hour">{String(startHour + i).padStart(2, "0")}:00</div>)}</div>
          {cols.map((c, ci) => {
            const ranges = rangesFor(settings, c.day), base = new Date(c.day.getFullYear(), c.day.getMonth(), c.day.getDate(), startHour);
            return (
              <div key={ci} className={"cal-col" + (!ranges.length ? " closed" : "")}>
                {Array.from({ length: rows }, (_, qn) => {
                  const m = startHour * 60 + qn * 15, open = ranges.some(([f, t]) => m >= f && m < t);
                  return <div key={qn} className={"cal-slot" + (open ? "" : " off") + (qn % 4 === 0 ? " hour" : "")}
                    onClick={() => { if (can(P.AgendaEdit)) newAppt(new Date(base.getTime() + qn * 15 * 60000), c.doctor?.id); }}></div>;
                })}
                {c.items.map((a) => {
                  const s = parseDt(a.startAt)!, e = parseDt(a.endAt)!;
                  const top = ((s.getTime() - base.getTime()) / 60000) * PX, h = Math.max(18, ((e.getTime() - s.getTime()) / 60000) * PX - 2);
                  return (
                    <div key={a.id} className={`appt ${apptStatusCss(a.status)}${a.isUrgent ? " urgent" : ""}`} style={{ top: px(top), height: px(h), ["--c" as any]: a.actColor ?? a.doctorColor }}
                      onClick={(ev) => { ev.stopPropagation(); setSelected(a); }} title={`${a.patientName} - ${a.actLabel ?? ""}`}>
                      <b>{a.startAt.slice(11, 16)} {a.patientName}</b>
                      {h > 30 && <small>{a.actLabel ?? a.reason}{!c.doctor ? " · Dr " + a.doctorName : ""}</small>}
                      {!!a.patientAllergy && <i className="appt-flag" title="Allergie"><Icon n="alerte" /></i>}
                    </div>
                  );
                })}
                {fmtDay(c.day) === todayStr && now.getHours() >= startHour && now.getHours() < endHour &&
                  <div className="now-line" style={{ top: px(((now.getTime() - base.getTime()) / 60000) * PX) }}></div>}
              </div>
            );
          })}
        </div>
      </div>
      <div className="legend-row">{ALL.map((s) => <span key={s} className={`status ${apptStatusCss(s)}`}>{apptStatusLabel(s)}</span>)}</div>
      <AppointmentEditor open={!!editing} onClose={() => setEditing(null)} model={editing ?? {}} onSaved={items.reload} />
      <AppointmentDetail appt={selected} onClose={() => setSelected(null)} onChanged={items.reload}
        onEdit={(a) => { setSelected(null); setEditing({ ...a }); }} canConsult={can(P.AgendaConsult)} canEdit={can(P.AgendaEdit)} canRx={can(P.RxWrite)} />
    </>
  );
}
