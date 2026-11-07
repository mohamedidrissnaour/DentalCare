import type { Db } from "./db";
import { log } from "../obs/log";

/** Schéma versionné (PRAGMA user_version). Pour faire évoluer la base : ajouter une migration à la fin. */
const migrations: string[] = [
  // v1 : schéma complet
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    full_name TEXT NOT NULL, email TEXT, phone TEXT,
    role TEXT NOT NULL CHECK (role IN ('Principal','Docteur','Secretaire')),
    status TEXT NOT NULL DEFAULT 'Actif',
    password_hash TEXT NOT NULL, security_stamp TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0, lockout_until TEXT,
    rpps TEXT, specialty TEXT, color TEXT NOT NULL DEFAULT '#14B1BB',
    auto_print INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, last_login_at TEXT
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stamp TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, ip TEXT
  );
  CREATE TABLE patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT, file_no TEXT NOT NULL UNIQUE,
    last_name TEXT NOT NULL, first_name TEXT NOT NULL, birth_date TEXT NOT NULL, sex TEXT NOT NULL,
    phone TEXT NOT NULL, email TEXT, address TEXT, postal_code TEXT, city TEXT, ssn TEXT, mutuelle TEXT,
    allergies TEXT, medical_history TEXT, current_treatments TEXT, notes TEXT,
    primary_doctor_id INTEGER REFERENCES users(id),
    no_show_count INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX ix_patients_name ON patients(last_name, first_name);
  CREATE TABLE act_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, label TEXT NOT NULL,
    duration_min INTEGER NOT NULL, price REAL NOT NULL, color TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL REFERENCES patients(id), doctor_id INTEGER NOT NULL REFERENCES users(id),
    start_at TEXT NOT NULL, end_at TEXT NOT NULL, act_type_id INTEGER REFERENCES act_types(id),
    status TEXT NOT NULL DEFAULT 'Planifie', reason TEXT, notes TEXT, is_urgent INTEGER NOT NULL DEFAULT 0,
    cancel_reason TEXT, late_cancel INTEGER NOT NULL DEFAULT 0, arrived_at TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
  );
  CREATE INDEX ix_appt_doctor ON appointments(doctor_id, start_at);
  CREATE INDEX ix_appt_patient ON appointments(patient_id, start_at);
  CREATE TABLE invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT NOT NULL UNIQUE,
    patient_id INTEGER NOT NULL REFERENCES patients(id), doctor_id INTEGER NOT NULL REFERENCES users(id),
    issued_at TEXT NOT NULL, total REAL NOT NULL, paid REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'Impayee', created_by INTEGER NOT NULL REFERENCES users(id)
  );
  CREATE TABLE invoice_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    label TEXT NOT NULL, tooth INTEGER, qty INTEGER NOT NULL DEFAULT 1, unit_price REAL NOT NULL
  );
  CREATE TABLE payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER NOT NULL REFERENCES invoices(id),
    paid_at TEXT NOT NULL, amount REAL NOT NULL, method TEXT NOT NULL, received_by INTEGER NOT NULL REFERENCES users(id)
  );
  CREATE TABLE visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER NOT NULL REFERENCES patients(id),
    visit_day TEXT NOT NULL, queue_no INTEGER NOT NULL, arrived_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'EnAttente', priority INTEGER NOT NULL DEFAULT 0,
    doctor_id INTEGER REFERENCES users(id), appointment_id INTEGER REFERENCES appointments(id),
    complaint TEXT, diagnosis TEXT, diagnosis_by INTEGER REFERENCES users(id),
    called_at TEXT, started_at TEXT, ended_at TEXT,
    registered_by INTEGER NOT NULL REFERENCES users(id), notes TEXT
  );
  CREATE INDEX ix_visits_day ON visits(visit_day, status);
  CREATE INDEX ix_visits_patient ON visits(patient_id, arrived_at);
  CREATE TABLE treatment_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER NOT NULL REFERENCES patients(id),
    doctor_id INTEGER NOT NULL REFERENCES users(id), tooth INTEGER, act_type_id INTEGER REFERENCES act_types(id),
    label TEXT NOT NULL, sessions_planned INTEGER NOT NULL DEFAULT 1, estimated_price REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'EnCours', notes TEXT, created_at TEXT NOT NULL, closed_at TEXT
  );
  CREATE INDEX ix_plans_patient ON treatment_plans(patient_id, status);
  CREATE TABLE treatments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER NOT NULL REFERENCES patients(id),
    doctor_id INTEGER NOT NULL REFERENCES users(id), appointment_id INTEGER REFERENCES appointments(id),
    performed_at TEXT NOT NULL, tooth INTEGER, act_type_id INTEGER REFERENCES act_types(id),
    label TEXT NOT NULL, price REAL NOT NULL, notes TEXT, invoice_id INTEGER REFERENCES invoices(id),
    plan_id INTEGER REFERENCES treatment_plans(id), session_no INTEGER, visit_id INTEGER REFERENCES visits(id)
  );
  CREATE INDEX ix_treat_patient ON treatments(patient_id, performed_at);
  CREATE TABLE medications (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, form TEXT,
    default_dosage TEXT, default_frequency TEXT, default_duration TEXT, notes TEXT, active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE rx_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT, items_json TEXT NOT NULL
  );
  CREATE TABLE prescriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT NOT NULL UNIQUE,
    patient_id INTEGER NOT NULL REFERENCES patients(id), doctor_id INTEGER NOT NULL REFERENCES users(id),
    target_secretary_id INTEGER REFERENCES users(id), created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Brouillon', notes TEXT, urgent INTEGER NOT NULL DEFAULT 0,
    sent_at TEXT, printed_at TEXT, printed_by INTEGER REFERENCES users(id), print_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE prescription_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, prescription_id INTEGER NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
    position INTEGER NOT NULL, medication TEXT NOT NULL, dosage TEXT, frequency TEXT, duration TEXT, quantity TEXT, instructions TEXT
  );
  CREATE TABLE notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id), target_role TEXT,
    kind TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL, link TEXT, entity_id INTEGER,
    created_at TEXT NOT NULL, read_at TEXT, created_by_name TEXT
  );
  CREATE INDEX ix_notif_user ON notifications(user_id, read_at);
  CREATE TABLE notification_reads (notification_id INTEGER NOT NULL, user_id INTEGER NOT NULL, read_at TEXT NOT NULL, PRIMARY KEY (notification_id, user_id));
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, user_id INTEGER, username TEXT,
    action TEXT NOT NULL, entity TEXT, entity_id INTEGER, details TEXT, ip TEXT
  );
  CREATE INDEX ix_audit_at ON audit_log(at);
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
  CREATE TABLE role_permissions (
    role TEXT NOT NULL CHECK (role IN ('Docteur','Secretaire')), permission TEXT NOT NULL, allowed INTEGER NOT NULL,
    updated_at TEXT NOT NULL, updated_by INTEGER REFERENCES users(id), PRIMARY KEY (role, permission)
  );
  `,
];

export function migrate(db: Db) {
  const current = Number(db.scalar("PRAGMA user_version") ?? 0);
  for (let v = current; v < migrations.length; v++) {
    db.tx(() => {
      db.exec(migrations[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`); // entier constant, pas une entrée utilisateur
    });
    log.info("db", `Migration v${v + 1} appliquée`);
  }
  seed(db);
}

function seed(db: Db) {
  if (!db.scalar("SELECT COUNT(*) FROM act_types")) {
    const acts: [string, string, number, number, string][] = [
      ["CONS", "Consultation / bilan", 30, 23, "#14B1BB"], ["CTRL", "Contrôle", 20, 23, "#21CDC0"],
      ["DETA", "Détartrage", 30, 28.92, "#1BAE7E"], ["CARI", "Soin de carie", 45, 50, "#E0A030"],
      ["DEVI", "Dévitalisation", 60, 81.94, "#6C63D9"], ["EXTR", "Extraction", 45, 33.44, "#D9534F"],
      ["COUR", "Couronne", 60, 500, "#C9A227"], ["IMPL", "Implant", 90, 1200, "#0B7C84"],
      ["BLAN", "Blanchiment", 60, 350, "#7ADFE4"], ["ORTH", "Orthodontie", 30, 193.5, "#14866A"],
      ["RADI", "Radiographie panoramique", 15, 20, "#64748B"], ["URGE", "Urgence", 20, 30, "#C0392B"],
    ];
    for (const [code, label, dur, price, color] of acts)
      db.run("INSERT INTO act_types(code,label,duration_min,price,color) VALUES(@code,@label,@dur,@price,@color)", { code, label, dur, price, color });
  }
  if (!db.scalar("SELECT COUNT(*) FROM medications")) {
    const meds: [string, string, string, string, string][] = [
      ["Amoxicilline 1 g", "Comprimé", "1 comprimé", "2 fois par jour", "7 jours"],
      ["Amoxicilline 500 mg", "Gélule", "2 gélules", "2 fois par jour", "7 jours"],
      ["Clindamycine 300 mg", "Gélule", "2 gélules", "2 fois par jour", "7 jours"],
      ["Spiramycine + Métronidazole", "Comprimé", "2 comprimés", "3 fois par jour", "7 jours"],
      ["Métronidazole 500 mg", "Comprimé", "1 comprimé", "3 fois par jour", "7 jours"],
      ["Azithromycine 250 mg", "Comprimé", "2 comprimés", "1 fois par jour", "3 jours"],
      ["Paracétamol 1 g", "Comprimé", "1 comprimé", "toutes les 6 h si douleur (max 4/j)", "5 jours"],
      ["Ibuprofène 400 mg", "Comprimé", "1 comprimé", "3 fois par jour au cours des repas", "3 jours"],
      ["Paracétamol + Codéine 500/30 mg", "Comprimé", "1 à 2 comprimés", "toutes les 6 h si douleur", "3 jours"],
      ["Prednisolone 20 mg", "Comprimé", "1 mg/kg", "le matin", "3 jours"],
      ["Chlorhexidine 0,12 % bain de bouche", "Solution", "1 bain de bouche (15 ml)", "3 fois par jour après brossage", "10 jours"],
      ["Acide tranexamique 1 g", "Ampoule buvable", "1 ampoule", "en compresse sur le site", "2 jours"],
      ["Gel fluoré 1,25 %", "Gel", "application", "1 fois par semaine", "3 mois"],
      ["Dentifrice fluoré 5000 ppm", "Pâte", "brossage", "3 fois par jour", "3 mois"],
      ["Brosse à dents chirurgicale 7/100", "Dispositif", "1", "après chaque repas", "15 jours"],
      ["Compresses stériles", "Dispositif", "1 boîte", "si saignement", "-"],
    ];
    for (const [n, f, d, fr, du] of meds)
      db.run("INSERT INTO medications(name,form,default_dosage,default_frequency,default_duration) VALUES(@n,@f,@d,@fr,@du)", { n, f, d, fr, du });
  }
  if (!db.scalar("SELECT COUNT(*) FROM rx_templates")) {
    const I = (medication: string, dosage: string, frequency: string, duration: string, quantity: string) => ({ medication, dosage, frequency, duration, quantity });
    const tpls: [string, string, object[]][] = [
      ["Post-extraction", "Antalgique + bain de bouche + hémostase", [
        I("Paracétamol 1 g", "1 comprimé", "toutes les 6 h si douleur (max 4/j)", "5 jours", "1 boîte"),
        I("Chlorhexidine 0,12 % bain de bouche", "1 bain de bouche (15 ml)", "3 fois par jour, à partir du lendemain", "10 jours", "1 flacon"),
        I("Compresses stériles", "1 boîte", "mordre 20 min si saignement", "-", "1 boîte")]],
      ["Infection dentaire", "Antibiothérapie de 1re intention + antalgique", [
        I("Amoxicilline 1 g", "1 comprimé", "2 fois par jour", "7 jours", "1 boîte"),
        I("Paracétamol 1 g", "1 comprimé", "toutes les 6 h si douleur (max 4/j)", "5 jours", "1 boîte")]],
      ["Allergie pénicilline", "Alternative sans bêta-lactamine", [
        I("Clindamycine 300 mg", "2 gélules", "2 fois par jour", "7 jours", "2 boîtes"),
        I("Paracétamol 1 g", "1 comprimé", "toutes les 6 h si douleur (max 4/j)", "5 jours", "1 boîte")]],
      ["Douleur post-opératoire", "Palier 1 + AINS", [
        I("Paracétamol 1 g", "1 comprimé", "toutes les 6 h", "3 jours", "1 boîte"),
        I("Ibuprofène 400 mg", "1 comprimé", "3 fois par jour au cours des repas", "3 jours", "1 boîte")]],
      ["Prévention carieuse", "Fluor haute concentration", [
        I("Dentifrice fluoré 5000 ppm", "brossage", "3 fois par jour", "3 mois", "1 tube"),
        I("Gel fluoré 1,25 %", "application", "1 fois par semaine", "3 mois", "1 tube")]],
    ];
    for (const [name, description, items] of tpls)
      db.run("INSERT INTO rx_templates(name,description,items_json) VALUES(@name,@description,@json)", { name, description, json: JSON.stringify(items) });
  }
}
