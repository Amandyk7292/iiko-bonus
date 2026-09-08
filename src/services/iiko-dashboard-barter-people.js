const { supabase } = require('../config/supabase');
const { failure } = require('./iiko-dashboard-client');
const { withPeople } = require('./iiko-dashboard-barters');

async function people(report, db = supabase) {
  const names = [];
  const keys = report.checks.map((row) => row.identity);
  for (let offset = 0; offset < keys.length; offset += 80) {
    const { data, error } = await db
      .from('iiko_barter_people')
      .select('document_key,blogger_name')
      .eq('city', report.city)
      .in('document_key', keys.slice(offset, offset + 80));
    if (error) throw failure('IIKO_REPORT_PEOPLE');
    names.push(...(data || []));
  }
  return withPeople(report, names);
}
async function savePerson(report, input, actor, db = supabase) {
  const document = report.checks.find((row) => row.identity === input.documentKey);
  if (!document) throw failure('IIKO_REPORT_DOCUMENT', 404);
  const { error } = await db.from('iiko_barter_people').upsert(
    {
      document_key: document.identity,
      city: document.city,
      document_number: document.Document,
      document_date: document.Date,
      department: document.Department,
      blogger_name: input.bloggerName,
      updated_by: String(actor || 'unknown').slice(0, 160),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'document_key' },
  );
  if (error) throw failure('IIKO_REPORT_PEOPLE');
  return { saved: true };
}
module.exports = { people, savePerson };
