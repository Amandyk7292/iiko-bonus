const { supabase } = require('../config/supabase');
const { branchScopeForAdmin } = require('../utils/admin-scope.util');
const {
  createRoundsAccess,
  data,
  fail,
  branchFields,
  inspectorFields,
  inspectorDto,
  assertAdminBranch,
} = require('./rounds-access.service');
const listFields =
  'id,title,round_date,deadline,branch_id,inspector_id,completed_at,cancelled_at,branch:bulka_locations(id,name,city,active),inspector:inspection_inspectors(id,name),tasks:inspection_tasks(id,completed_at)';
const roundSummary = (r, now = new Date()) => {
  const tasks = r.tasks || [];
  const completedTasks = tasks.filter((t) => t.completed_at).length;
  const status = r.cancelled_at
    ? 'cancelled'
    : r.completed_at
      ? 'completed'
      : new Date(r.deadline) < now
        ? 'overdue'
        : completedTasks
          ? 'in_progress'
          : 'pending';
  return {
    id: r.id,
    title: r.title,
    date: r.round_date,
    deadline: r.deadline,
    branchId: r.branch_id,
    branchName: r.branch?.name || '',
    city: r.branch?.city || '',
    inspectorId: r.inspector_id,
    inspectorName: r.inspector?.name || '',
    status,
    completedAt: r.completed_at,
    completedLate: !!r.completed_at && new Date(r.completed_at) > new Date(r.deadline),
    totalTasks: tasks.length,
    completedTasks,
  };
};
const mediaDto = (m, admin = false) => ({
  id: m.id,
  kind: m.kind,
  mime: m.mime,
  bytes: m.bytes,
  createdAt: m.created_at,
  url: `${admin ? '/admin' : ''}/api/rounds/media/${m.id}`,
});
function createRoundsService({ db = supabase, now = () => new Date() } = {}) {
  const access = createRoundsAccess({ db, now });
  const getRound = async (id, actor, admin = false) => {
    const r = await data(
      db.from('inspection_rounds').select(listFields).eq('id', id).maybeSingle(),
    );
    if (!r) throw fail('Обход не найден', 404, 'ROUNDS_NOT_FOUND');
    if (admin) assertAdminBranch(actor, r.branch_id);
    else {
      if (r.inspector_id !== actor.inspector.id)
        throw fail('Обход не найден', 404, 'ROUNDS_NOT_FOUND');
      await access.assertStaffBranch(actor, r.branch_id);
    }
    return r;
  };
  const detail = async (actor, id, admin = false) => {
    const r = await getRound(id, actor, admin);
    const tasks = await data(
      db
        .from('inspection_tasks')
        .select('*,evidence:inspection_media(id,kind,mime,bytes,created_at)')
        .eq('round_id', id)
        .order('position'),
    );
    return {
      round: {
        ...roundSummary(r, now()),
        tasks: tasks.map((t) => ({
          id: t.id,
          title: t.title,
          instructions: t.instructions,
          evidenceType: t.evidence_type,
          position: t.position,
          completedAt: t.completed_at,
          comment: t.comment,
          evidence: t.evidence.map((m) => mediaDto(m, admin)),
        })),
      },
    };
  };
  const staffTask = async (actor, id) => {
    const t = await data(
      db
        .from('inspection_tasks')
        .select('id,round_id,completed_at,evidence_type')
        .eq('id', id)
        .maybeSingle(),
    );
    if (!t) throw fail('Задание не найдено', 404, 'ROUNDS_NOT_FOUND');
    const r = await getRound(t.round_id, actor);
    if (r.cancelled_at) throw fail('Обход отменён', 409, 'ROUNDS_CANCELLED');
    return { task: t, round: r };
  };
  return {
    ...access,
    async dashboard(admin, { from, to, city }) {
      const scope = branchScopeForAdmin(admin);
      let branchesQuery = db.from('bulka_locations').select(branchFields).order('name');
      if (scope.length) branchesQuery = branchesQuery.in('id', scope);
      if (city) branchesQuery = branchesQuery.eq('city', city);
      const branches = await data(branchesQuery);
      const branchIds = branches.map((b) => b.id);
      const inspectors = (
        await data(db.from('inspection_inspectors').select(inspectorFields).order('name'))
      )
        .filter(
          (i) =>
            (!scope.length || i.branch_ids.every((id) => scope.includes(id))) &&
            (!city || i.city === city),
        )
        .map(inspectorDto);
      // Explicit 500-row pages stay below PostgREST's response row cap.
      const rounds = [];
      if (branchIds.length) {
        for (let offset = 0; offset <= 2000; offset += 500) {
          const page = await data(
            db
              .from('inspection_rounds')
              .select(listFields)
              .in('branch_id', branchIds)
              .gte('round_date', from)
              .lte('round_date', to)
              .order('round_date', { ascending: false })
              .order('deadline')
              .order('id')
              .range(offset, offset + 499),
          );
          rounds.push(...page);
          if (rounds.length > 2000)
            throw fail('Выберите более короткий период', 400, 'ROUNDS_RANGE_LIMIT');
          if (page.length < 500) break;
        }
      }
      return { branches, inspectors, rounds: rounds.map((r) => roundSummary(r, now())) };
    },
    async create(admin, values) {
      await access.adminInspector(admin, values.inspectorId);
      values.branchIds.forEach((id) => assertAdminBranch(admin, id));
      const ids = await data(
        db.rpc('inspection_create_rounds', {
          p_inspector_id: values.inspectorId,
          p_branch_ids: values.branchIds,
          p_title: values.title,
          p_date: values.date,
          p_deadline: values.deadline,
          p_tasks: values.tasks,
          p_created_by: String(admin.username || admin.id || 'admin'),
          p_admin_scope: branchScopeForAdmin(admin),
        }),
      );
      const rounds = await data(db.from('inspection_rounds').select(listFields).in('id', ids));
      return { rounds: rounds.map((r) => roundSummary(r, now())) };
    },
    adminDetail: (admin, id) => detail(admin, id, true),
    async cancel(admin, id) {
      const r = await getRound(id, admin, true);
      if (r.completed_at)
        throw fail('Завершённый обход нельзя отменить', 409, 'ROUNDS_TASK_COMPLETED');
      const changed = await data(
        db
          .from('inspection_rounds')
          .update({ cancelled_at: now().toISOString() })
          .eq('id', id)
          .is('completed_at', null)
          .select('id')
          .maybeSingle(),
      );
      if (!changed) throw fail('Обход уже завершён', 409, 'ROUNDS_TASK_COMPLETED');
      return {};
    },
    async list(actor, date) {
      const branches = await data(
        db
          .from('bulka_locations')
          .select('id')
          .in('id', actor.inspector.branch_ids)
          .eq('city', actor.inspector.city)
          .eq('active', true),
      );
      const rounds = branches.length
        ? await data(
            db
              .from('inspection_rounds')
              .select(listFields)
              .eq('inspector_id', actor.inspector.id)
              .in(
                'branch_id',
                branches.map((b) => b.id),
              )
              .eq('round_date', date)
              .order('deadline')
              .limit(501),
          )
        : [];
      if (rounds.length > 500)
        throw fail('Слишком много обходов на день. Обратитесь к администратору');
      return {
        inspector: inspectorDto(actor.inspector),
        rounds: rounds.map((r) => roundSummary(r, now())),
      };
    },
    detail: (actor, id) => detail(actor, id),
    staffTask,
    async complete(actor, taskId, comment) {
      await staffTask(actor, taskId);
      const roundId = await data(
        db.rpc('inspection_complete_task', {
          p_inspector_id: actor.inspector.id,
          p_session_id: actor.sessionId,
          p_task_id: taskId,
          p_comment: comment,
        }),
      );
      return detail(actor, roundId);
    },
    async registerMedia(actor, taskId, value) {
      await data(
        db.rpc('inspection_register_media', {
          p_inspector_id: actor.inspector.id,
          p_session_id: actor.sessionId,
          p_task_id: taskId,
          p_id: value.id,
          p_file_name: value.fileName,
          p_kind: value.kind,
          p_mime: value.mime,
          p_bytes: value.bytes,
        }),
      );
      return mediaDto({ ...value, created_at: now().toISOString() });
    },
    async deleteMedia(actor, id) {
      return data(
        db.rpc('inspection_delete_media', {
          p_inspector_id: actor.inspector.id,
          p_session_id: actor.sessionId,
          p_media_id: id,
        }),
      );
    },
    async readMedia(actor, id, admin = false) {
      const m = await data(db.from('inspection_media').select('*').eq('id', id).maybeSingle());
      if (!m) throw fail('Материал не найден', 404, 'ROUNDS_NOT_FOUND');
      const t = await data(
        db.from('inspection_tasks').select('round_id').eq('id', m.task_id).single(),
      );
      await getRound(t.round_id, actor, admin);
      return m;
    },
  };
}
const rounds = createRoundsService();
module.exports = { createRoundsService, rounds, roundSummary, mediaDto };
