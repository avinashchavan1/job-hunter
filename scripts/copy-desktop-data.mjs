// Copies one person's jobs, scores, tracker status and interview prep from the desktop app's
// database (read-only) into SQL files for the web database.
//   node scripts/copy-desktop-data.mjs <desktopProfileId> <webProfileId> <outDir>
// Then run each out/NN.sql with `supabase db query --remote=... -f`.
// Existing web rows win, except tracker status: a desktop status replaces a web "new".
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const [dpid, wpid, out] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4]]
if (!dpid || !wpid || !out) throw new Error('usage: copy-desktop-data.mjs <desktopProfileId> <webProfileId> <outDir>')
const db = new DatabaseSync(join(homedir(), 'Library/Application Support/job-hunter/data/jobs.db'), { readOnly: true })
mkdirSync(out, { recursive: true })

const q = (s) => (s == null ? 'null' : `'${String(s).replace(/'/g, "''")}'`)
const ts = (s) => (s ? q(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}+05:30`) + '::timestamptz' : 'now()') // desktop stored India local time
const js = (s) => (s ? `${q(s)}::jsonb` : `'[]'::jsonb`)

const rows = db
  .prepare(
    `SELECT j.*, pj.found_at, pj.sources, pj.filter_reason,
            s.score, s.reasons, s.red_flags, s.cover_note, s.model, s.scored_at, s.matched, s.missing,
            a.status, a.notes, a.updated_at AS status_at
     FROM profile_jobs pj JOIN jobs j ON j.id = pj.job_id
     LEFT JOIN scores s ON s.profile_id = pj.profile_id AND s.job_id = pj.job_id
     LEFT JOIN applications a ON a.profile_id = pj.profile_id AND a.job_id = pj.job_id
     WHERE pj.profile_id = ?`
  )
  .all(dpid)

let n = 0
for (let i = 0; i < rows.length; i += 25) {
  const chunk = rows.slice(i, i + 25)
  const sql = ['begin;']
  for (const r of chunk) {
    sql.push(
      `insert into public.jh_jobs (id,title,company,location,salary,url,description,source,posted_at,external_id,first_seen,last_seen) values (${[r.id, r.title, r.company, r.location, r.salary, r.url, r.description, r.source, r.posted_at, r.external_id].map(q).join(',')},${ts(r.first_seen)},${ts(r.last_seen)})
       on conflict (id) do update set description = case when length(coalesce(excluded.description,'')) > length(coalesce(jh_jobs.description,'')) then excluded.description else jh_jobs.description end,
         url = coalesce(nullif(jh_jobs.url,''), excluded.url), salary = coalesce(nullif(jh_jobs.salary,''), excluded.salary);`,
      `insert into public.jh_profile_jobs (profile_id,job_id,found_at,sources,filter_reason) values (${wpid},${q(r.id)},${ts(r.found_at)},${q(r.sources || '')},${q(r.filter_reason)}) on conflict do nothing;`
    )
    if (r.score != null)
      sql.push(
        `insert into public.jh_scores (profile_id,job_id,score,reasons,red_flags,cover_note,model,scored_at,matched,missing) values (${wpid},${q(r.id)},${Number(r.score)},${js(r.reasons)},${js(r.red_flags)},${q(r.cover_note)},${q(r.model)},${ts(r.scored_at)},${js(r.matched)},${js(r.missing)}) on conflict do nothing;`
      )
    sql.push(
      `insert into public.jh_applications (profile_id,job_id,status,notes,updated_at) values (${wpid},${q(r.id)},${q(r.status || 'new')},${q(r.notes || '')},${ts(r.status_at)})
       on conflict (profile_id,job_id) do update set status = excluded.status, notes = case when excluded.notes <> '' then excluded.notes else jh_applications.notes end, updated_at = excluded.updated_at
       where jh_applications.status = 'new' and excluded.status <> 'new';`
    )
  }
  sql.push('commit;')
  writeFileSync(join(out, `${String(++n).padStart(2, '0')}-jobs.sql`), sql.join('\n'))
}

// interview prep (tailored PDFs live on the Mac and are not copied)
const preps = db.prepare("SELECT k, v FROM kv WHERE k LIKE 'prep:' || ? || ':%'").all(String(dpid))
if (preps.length)
  writeFileSync(
    join(out, `${String(++n).padStart(2, '0')}-prep.sql`),
    preps.map((p) => `insert into public.jh_kv (k, v) values (${q(p.k.replace(`prep:${dpid}:`, `prep:${wpid}:`))}, ${q(p.v)}::jsonb) on conflict (k) do nothing;`).join('\n')
  )

const by = (f) => rows.reduce((m, r) => ((m[f(r)] = (m[f(r)] || 0) + 1), m), {})
console.log(JSON.stringify({ jobs: rows.length, scored: rows.filter((r) => r.score != null).length, filtered: rows.filter((r) => r.filter_reason).length, status: by((r) => r.status || 'new'), prep: preps.length, files: n }))
