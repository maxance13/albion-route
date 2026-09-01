import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const app = express();
const PORT = Number(process.env.PORT || 10000);
const JWT_SECRET = process.env.JWT_SECRET || 'development-only-change-me';
let pool = null;
let dbError = null;

if (process.env.DATABASE_URL) {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false, max: 8 });
}
const q = (text, params = []) => {
  if (!pool) throw new Error('DATABASE_URL_NOT_CONFIGURED');
  return pool.query(text, params);
};

async function ensureSchema() {
  if (!pool) return;
  try {
    await pool.query(fs.readFileSync(path.join(root, 'db', 'schema.sql'), 'utf8'));
    dbError = null;
  } catch (error) {
    dbError = error.message;
    console.error('Database initialization failed:', error);
  }
}
await ensureSchema();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({ windowMs: 60_000, limit: 240 }));

function signUser(u) {
  return jwt.sign({ id: u.id, guildId: u.guild_id, role: u.role, username: u.username }, JWT_SECRET, { expiresIn: '12h' });
}
function requireAuth(req, res, next) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ error: 'Non authentifié' });
  try { req.user = jwt.verify(h.slice(7), JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: 'Session expirée ou invalide' }); }
}
const allow = (...roles) => (req, res, next) => req.user && roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Accès refusé' });
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get('/health', asyncRoute(async (_req, res) => {
  let database = false;
  if (pool) { try { await q('select 1'); database = true; } catch (e) { dbError = e.message; } }
  res.status(database || !process.env.DATABASE_URL ? 200 : 503).json({ ok: true, database, configured: Boolean(process.env.DATABASE_URL), dbError });
}));
app.get('/api/status', asyncRoute(async (_req, res) => {
  let database = false;
  if (pool) { try { await q('select 1'); database = true; } catch (e) { dbError = e.message; } }
  res.json({ database, configured: Boolean(process.env.DATABASE_URL), dbError });
}));

app.post('/api/auth/setup', asyncRoute(async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Base de données non connectée' });
  const s = z.object({ guildName: z.string().min(2), username: z.string().min(2), email: z.string().email(), password: z.string().min(8) }).parse(req.body);
  const count = await q('select count(*)::int c from guilds');
  if (count.rows[0].c > 0) return res.status(409).json({ error: 'Initialisation déjà effectuée' });
  const hash = await bcrypt.hash(s.password, 12);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const g = await client.query('insert into guilds(name) values($1) returning id,name,server,tax_rate', [s.guildName]);
    const u = await client.query("insert into app_users(guild_id,username,email,password_hash,role) values($1,$2,$3,$4,'admin') returning id,guild_id,username,email,role", [g.rows[0].id, s.username, s.email, hash]);
    await client.query('COMMIT');
    res.status(201).json({ guild: g.rows[0], user: u.rows[0] });
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));
app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const s = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
  const r = await q('select * from app_users where lower(email)=lower($1) and active=true', [s.email]);
  const u = r.rows[0];
  if (!u || !await bcrypt.compare(s.password, u.password_hash)) return res.status(401).json({ error: 'Identifiants invalides' });
  res.json({ token: signUser(u), user: { id: u.id, username: u.username, email: u.email, role: u.role } });
}));
app.get('/api/me', requireAuth, asyncRoute(async (req,res)=>{
  const r=await q('select u.id,u.username,u.email,u.role,g.name as guild_name,g.server,g.tax_rate from app_users u join guilds g on g.id=u.guild_id where u.id=$1',[req.user.id]);
  res.json(r.rows[0]);
}));

app.get('/api/dashboard', requireAuth, asyncRoute(async (req,res)=>{
  const g=req.user.guildId;
  const [m,e,l,p,t,r]=await Promise.all([
    q("select count(*)::int n from members where guild_id=$1 and status='Actif'",[g]),
    q('select count(*)::int n from events where guild_id=$1',[g]),
    q('select coalesce(sum(quantity*unit_price),0)::bigint n from loot_items where guild_id=$1',[g]),
    q("select coalesce(sum(net_amount),0)::bigint n from payouts where guild_id=$1 and status='A payer'",[g]),
    q("select coalesce(sum(case when entry_type='Entree' then amount else -amount end),0)::bigint n from treasury_entries where guild_id=$1",[g]),
    q("select count(*)::int n from recruitment_candidates where guild_id=$1 and status not in ('Accepté','Refusé')",[g])
  ]);
  const guild=(await q('select name,server,tax_rate from guilds where id=$1',[g])).rows[0];
  res.json({guild,activeMembers:m.rows[0].n,events:e.rows[0].n,loot:Number(l.rows[0].n),payoutDue:Number(p.rows[0].n),treasury:Number(t.rows[0].n),recruitment:r.rows[0].n});
}));

app.get('/api/members', requireAuth, asyncRoute(async(req,res)=>res.json((await q('select * from members where guild_id=$1 order by pseudo',[req.user.guildId])).rows)));
app.post('/api/members', requireAuth, allow('admin','officer'), asyncRoute(async(req,res)=>{
  const s=z.object({pseudo:z.string().min(2),discord:z.string().optional(),primary_role:z.string().optional(),guild_rank:z.string().default('Membre'),status:z.string().default('Actif'),build:z.string().optional(),average_ip:z.coerce.number().int().optional(),notes:z.string().optional()}).parse(req.body);
  const r=await q('insert into members(guild_id,pseudo,discord,primary_role,guild_rank,status,build,average_ip,notes,joined_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,current_date) returning *',[req.user.guildId,s.pseudo,s.discord||null,s.primary_role||null,s.guild_rank,s.status,s.build||null,s.average_ip||null,s.notes||null]);res.status(201).json(r.rows[0]);
}));
app.patch('/api/members/:id', requireAuth, allow('admin','officer'), asyncRoute(async(req,res)=>{const s=z.object({status:z.string().optional(),guild_rank:z.string().optional(),build:z.string().optional(),average_ip:z.coerce.number().int().optional(),notes:z.string().optional()}).parse(req.body);const r=await q('update members set status=coalesce($1,status),guild_rank=coalesce($2,guild_rank),build=coalesce($3,build),average_ip=coalesce($4,average_ip),notes=coalesce($5,notes),updated_at=now() where id=$6 and guild_id=$7 returning *',[s.status||null,s.guild_rank||null,s.build||null,s.average_ip??null,s.notes||null,req.params.id,req.user.guildId]);res.json(r.rows[0]);}));
app.delete('/api/members/:id', requireAuth, allow('admin'), asyncRoute(async(req,res)=>{await q('delete from members where id=$1 and guild_id=$2',[req.params.id,req.user.guildId]);res.status(204).end();}));

app.get('/api/events', requireAuth, asyncRoute(async(req,res)=>res.json((await q('select e.*,(select count(*) from attendances a where a.event_id=e.id) participant_count from events e where guild_id=$1 order by starts_at desc',[req.user.guildId])).rows)));
app.post('/api/events', requireAuth, allow('admin','officer'), asyncRoute(async(req,res)=>{const s=z.object({code:z.string().min(2),starts_at:z.string(),type:z.string().min(2),leader:z.string().optional(),zone:z.string().optional(),tier:z.string().optional(),min_ip:z.coerce.number().int().optional(),status:z.string().default('Prévu'),notes:z.string().optional()}).parse(req.body);const r=await q('insert into events(guild_id,code,starts_at,type,leader,zone,tier,min_ip,status,notes) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *',[req.user.guildId,s.code,s.starts_at,s.type,s.leader||null,s.zone||null,s.tier||null,s.min_ip||null,s.status,s.notes||null]);res.status(201).json(r.rows[0]);}));

app.get('/api/attendance/:eventId',requireAuth,asyncRoute(async(req,res)=>res.json((await q('select a.*,m.pseudo from attendances a join members m on m.id=a.member_id join events e on e.id=a.event_id where a.event_id=$1 and e.guild_id=$2 order by m.pseudo',[req.params.eventId,req.user.guildId])).rows)));
app.post('/api/attendance/:eventId',requireAuth,allow('admin','officer'),asyncRoute(async(req,res)=>{const s=z.object({member_id:z.string().uuid(),attendance_status:z.string().default('Présent'),payout_weight:z.coerce.number().nonnegative().default(1),role:z.string().optional(),notes:z.string().optional()}).parse(req.body);const r=await q('insert into attendances(event_id,member_id,attendance_status,payout_weight,role,notes) select $1,$2,$3,$4,$5,$6 where exists(select 1 from events where id=$1 and guild_id=$7) on conflict(event_id,member_id) do update set attendance_status=excluded.attendance_status,payout_weight=excluded.payout_weight,role=excluded.role,notes=excluded.notes returning *',[req.params.eventId,s.member_id,s.attendance_status,s.payout_weight,s.role||null,s.notes||null,req.user.guildId]);res.status(201).json(r.rows[0]);}));

app.get('/api/loot', requireAuth, asyncRoute(async(req,res)=>res.json((await q('select l.*,e.code event_code,(quantity*unit_price)::bigint total_value from loot_items l left join events e on e.id=l.event_id where l.guild_id=$1 order by l.created_at desc',[req.user.guildId])).rows)));
app.post('/api/loot', requireAuth, allow('admin','officer'), asyncRoute(async(req,res)=>{const s=z.object({event_id:z.string().uuid().nullable().optional(),item_name:z.string().min(1),category:z.string().default('Stuff'),tier:z.string().optional(),quantity:z.coerce.number().int().positive().default(1),unit_price:z.coerce.number().int().nonnegative().default(0),sold:z.coerce.boolean().default(false),notes:z.string().optional()}).parse(req.body);const r=await q('insert into loot_items(guild_id,event_id,item_name,category,tier,quantity,unit_price,sold,notes) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *',[req.user.guildId,s.event_id||null,s.item_name,s.category,s.tier||null,s.quantity,s.unit_price,s.sold,s.notes||null]);res.status(201).json(r.rows[0]);}));

app.get('/api/payouts', requireAuth, asyncRoute(async(req,res)=>res.json((await q('select p.*,m.pseudo,e.code event_code from payouts p join members m on m.id=p.member_id join events e on e.id=p.event_id where p.guild_id=$1 order by p.created_at desc',[req.user.guildId])).rows)));
app.post('/api/payouts/generate/:eventId',requireAuth,allow('admin','officer'),asyncRoute(async(req,res)=>{const g=req.user.guildId;const ev=(await q('select id from events where id=$1 and guild_id=$2',[req.params.eventId,g])).rows[0];if(!ev)return res.status(404).json({error:'Événement introuvable'});const loot=(await q('select coalesce(sum(quantity*unit_price),0)::bigint total from loot_items where event_id=$1 and guild_id=$2',[req.params.eventId,g])).rows[0];const at=await q("select * from attendances where event_id=$1 and payout_weight>0 and attendance_status not in ('Absent','Excusé')",[req.params.eventId]);if(!at.rows.length)return res.status(400).json({error:'Aucun participant avec poids payout'});const tax=Number((await q('select tax_rate from guilds where id=$1',[g])).rows[0].tax_rate);const total=Number(loot.total);const totalWeight=at.rows.reduce((a,x)=>a+Number(x.payout_weight),0);for(const a of at.rows){const gross=Math.round(total*Number(a.payout_weight)/totalWeight);await q("insert into payouts(guild_id,event_id,member_id,gross_amount,tax_rate) values($1,$2,$3,$4,$5) on conflict(event_id,member_id) do update set gross_amount=excluded.gross_amount,tax_rate=excluded.tax_rate,status='A payer'",[g,req.params.eventId,a.member_id,gross,tax])}res.json({ok:true,total,participants:at.rows.length,taxRate:tax});}));
app.patch('/api/payouts/:id/pay',requireAuth,allow('admin','officer'),asyncRoute(async(req,res)=>{const r=await q("update payouts set status='Payé',paid_at=now() where id=$1 and guild_id=$2 returning *",[req.params.id,req.user.guildId]);res.json(r.rows[0]);}));

app.get('/api/treasury',requireAuth,asyncRoute(async(req,res)=>res.json((await q('select * from treasury_entries where guild_id=$1 order by occurred_at desc',[req.user.guildId])).rows)));
app.post('/api/treasury',requireAuth,allow('admin','officer'),asyncRoute(async(req,res)=>{const s=z.object({entry_type:z.enum(['Entree','Sortie']),category:z.string(),description:z.string(),amount:z.coerce.number().int().nonnegative(),responsible:z.string().optional(),reference:z.string().optional()}).parse(req.body);const r=await q('insert into treasury_entries(guild_id,entry_type,category,description,amount,responsible,reference) values($1,$2,$3,$4,$5,$6,$7) returning *',[req.user.guildId,s.entry_type,s.category,s.description,s.amount,s.responsible||null,s.reference||null]);res.status(201).json(r.rows[0]);}));

app.get('/api/recruitment',requireAuth,asyncRoute(async(req,res)=>res.json((await q('select * from recruitment_candidates where guild_id=$1 order by created_at desc',[req.user.guildId])).rows)));
app.post('/api/recruitment',requireAuth,allow('admin','officer'),asyncRoute(async(req,res)=>{const s=z.object({pseudo:z.string().min(2),discord:z.string().optional(),target_role:z.string().optional(),experience:z.string().optional(),status:z.string().default('Nouveau'),trial_end:z.string().optional(),recruiter:z.string().optional(),notes:z.string().optional()}).parse(req.body);const r=await q('insert into recruitment_candidates(guild_id,pseudo,discord,target_role,experience,status,trial_end,recruiter,notes) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *',[req.user.guildId,s.pseudo,s.discord||null,s.target_role||null,s.experience||null,s.status,s.trial_end||null,s.recruiter||null,s.notes||null]);res.status(201).json(r.rows[0]);}));

app.patch('/api/guild/settings',requireAuth,allow('admin'),asyncRoute(async(req,res)=>{const s=z.object({name:z.string().min(2).optional(),tax_rate:z.coerce.number().min(0).max(1).optional()}).parse(req.body);const r=await q('update guilds set name=coalesce($1,name),tax_rate=coalesce($2,tax_rate),updated_at=now() where id=$3 returning *',[s.name||null,s.tax_rate??null,req.user.guildId]);res.json(r.rows[0]);}));

app.use(express.static(path.join(root,'public')));
app.get('/{*splat}', (_req,res)=>res.sendFile(path.join(root,'public','index.html')));
app.use((err,_req,res,_next)=>{console.error(err);if(err?.name==='ZodError')return res.status(400).json({error:'Données invalides',details:err.issues});if(err?.code==='23505')return res.status(409).json({error:'Cette donnée existe déjà'});if(err?.message==='DATABASE_URL_NOT_CONFIGURED')return res.status(503).json({error:'Base de données non connectée'});res.status(500).json({error:'Erreur serveur'});});

app.listen(PORT,'0.0.0.0',()=>console.log(`Albion Guild Manager listening on ${PORT}`));
