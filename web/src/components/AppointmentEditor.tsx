import { useEffect, useRef, useState } from "react";
import { Modal, Alerts, Loader } from "./ui";
import { Icon } from "./Icon";
import { PatientPicker } from "./PatientPicker";
import { api, qs } from "../lib/api";
import { useSession } from "../lib/session";
import { useToasts } from "../lib/toasts";
import { fmtDay, fmtDateTime, parseDt } from "../../../shared/domain";
import { dLongShort } from "../lib/format";

/** Prise / modification de rendez-vous, avec contrôle des règles en direct et créneaux libres proposés. */
export function AppointmentEditor({ open, onClose, model, onSaved }: { open: boolean; onClose: () => void; model: any; onSaved?: () => void }) {
  const { ref } = useSession();
  const toasts = useToasts();
  const [m, setM] = useState<any>({});
  const [patient, setPatient] = useState<any>(null);
  const [date, setDate] = useState(fmtDay(new Date()));
  const [time, setTime] = useState("09:00");
  const [duration, setDuration] = useState(30);
  const [slots, setSlots] = useState<string[] | null>(null);
  const [check, setCheck] = useState<{ errors: string[]; warnings: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const autoPicked = useRef(false);

  // Réinitialisé seulement à l'ouverture ou pour un autre rendez-vous (pas à chaque rafraîchissement de la page).
  const initKey = open ? `${model.id ?? 0}|${model.startAt ?? ""}|${model.patientId ?? 0}|${model.doctorId ?? 0}` : "";
  useEffect(() => {
    if (!open) return;
    const s = parseDt(model.startAt), e = parseDt(model.endAt);
    setM({ id: 0, doctorId: 0, actTypeId: "", reason: "", notes: "", isUrgent: false, ...model });
    setDate(fmtDay(s ?? new Date())); setTime(s ? fmtDateTime(s).slice(11, 16) : "09:00");
    setDuration(s && e && e > s ? Math.round((e.getTime() - s.getTime()) / 60000) : 30);
    setCheck(null); setSlots(null); autoPicked.current = !!model.id;
    if (model.patientId) api.get(`/patients/${model.patientId}`).then(setPatient).catch(() => setPatient(null)); else setPatient(null);
  }, [initKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = `${date}T${time}:00`;
  const end = () => { const s = parseDt(start)!; return fmtDateTime(new Date(s.getTime() + duration * 60000)); };
  const payload = () => ({ ...m, patientId: patient?.id ?? 0, doctorId: Number(m.doctorId) || 0, actTypeId: Number(m.actTypeId) || null, startAt: start, endAt: end() });

  // Créneaux libres du praticien (nouveau rendez-vous).
  useEffect(() => {
    if (!open || m.id || !(Number(m.doctorId) > 0)) { setSlots(null); return; }
    const from = date < fmtDay(new Date()) ? fmtDay(new Date()) : date;
    setSlots(null);
    api.get<string[]>(`/appointments/free-slots${qs({ doctorId: m.doctorId, from, duration })}`).then((l) => {
      setSlots(l.slice(0, 10));
      if (!autoPicked.current && l.length && !l.includes(start)) { autoPicked.current = true; pick(l[0]); } // heure par défaut non disponible
    }).catch(() => setSlots([]));
  }, [open, m.doctorId, date, duration]); // eslint-disable-line react-hooks/exhaustive-deps

  // Contrôle des règles en direct.
  useEffect(() => {
    if (!open || !patient || !(Number(m.doctorId) > 0)) { setCheck(null); return; }
    const t = setTimeout(() => api.post("/appointments/check", payload()).then(setCheck).catch(() => undefined), 150);
    return () => clearTimeout(t);
  }, [open, patient?.id, m.doctorId, m.isUrgent, date, time, duration]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (s: string) => { setDate(s.slice(0, 10)); setTime(s.slice(11, 16)); };
  const onPatient = (p: any) => {
    setPatient(p);
    if (p && !(Number(m.doctorId) > 0) && p.primaryDoctorId && ref?.doctors.some((d) => d.id === p.primaryDoctorId)) setM((x: any) => ({ ...x, doctorId: p.primaryDoctorId }));
  };
  const onAct = (v: string) => {
    const act = ref?.actTypes.find((a) => a.id === Number(v));
    setM((x: any) => ({ ...x, actTypeId: v, reason: x.reason || act?.label || "" }));
    if (act) setDuration(act.durationMin);
  };
  const save = async () => {
    setSaving(true);
    try {
      const r = await api.post("/appointments", payload());
      r.warnings?.forEach((w: string) => toasts.warn(w));
      toasts.success(m.id ? "Rendez-vous enregistré" : "Rendez-vous créé", `${dLongShort(start)} à ${time}`);
      onClose(); onSaved?.();
    } catch (e: any) { setCheck({ errors: [e.message], warnings: [] }); }
    finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={m.id ? "Modifier le rendez-vous" : "Nouveau rendez-vous"} wide
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? "Enregistrement…" : "Enregistrer"}</button></>}>
      <div className="form">
        {/* Pas de <label> autour : un clic dans la liste serait relayé au bouton « changer ». */}
        <div className="field">Patient<PatientPicker patient={patient} onPick={onPatient} /></div>
        <div className="grid3">
          <label>Praticien
            <select value={m.doctorId ?? 0} onChange={(e) => setM((x: any) => ({ ...x, doctorId: Number(e.target.value) }))}>
              <option value={0}>- choisir -</option>
              {ref?.doctors.map((d) => <option key={d.id} value={d.id}>Dr {d.fullName}</option>)}
            </select>
          </label>
          <label>Acte
            <select value={m.actTypeId ?? ""} onChange={(e) => onAct(e.target.value)}>
              <option value="">- motif libre -</option>
              {ref?.actTypes.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.label} ({a.durationMin} min)</option>)}
            </select>
          </label>
          <label>Motif / précision<input value={m.reason ?? ""} maxLength={200} onChange={(e) => setM((x: any) => ({ ...x, reason: e.target.value }))} /></label>
          <label>Date<input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
          <label>Heure<input type="time" step={300} value={time} onChange={(e) => e.target.value && setTime(e.target.value)} /></label>
          <label>Durée (min)<input type="number" min={10} max={240} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value) || 30)} /></label>
        </div>
        <label className="check"><input type="checkbox" checked={!!m.isUrgent} onChange={(e) => setM((x: any) => ({ ...x, isUrgent: e.target.checked }))} /> Urgence (autorise un créneau hors horaires)</label>
        <label>Notes internes<textarea rows={2} maxLength={1000} value={m.notes ?? ""} onChange={(e) => setM((x: any) => ({ ...x, notes: e.target.value }))} /></label>
        {Number(m.doctorId) > 0 && !m.id && (
          <div className="slots">
            <span className="muted">Prochains créneaux libres :</span>
            {slots === null ? <Loader small /> : slots.map((s) => (
              <button type="button" key={s} className={"slot" + (s === start ? " on" : "")} onClick={() => pick(s)}>
                {parseDt(s)!.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" })} · {s.slice(11, 16)}
              </button>
            ))}
          </div>
        )}
        <Alerts errors={check?.errors} warnings={check?.warnings} />
        {check && !check.errors.length && !check.warnings.length && <div className="alert alert-success"><Icon n="valide" /> Créneau disponible et conforme aux règles du cabinet.</div>}
      </div>
    </Modal>
  );
}
