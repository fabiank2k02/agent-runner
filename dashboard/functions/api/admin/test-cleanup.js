import { authenticateApiRequest, cors, json } from "../../_shared/auth.js";

const cleanupTables = [
  {
    name: "summaries",
    deleteSql:
      "DELETE FROM summaries WHERE job_id IN (SELECT id FROM jobs WHERE id LIKE ? OR project_slug LIKE ? OR task_id LIKE ?)",
    countSql:
      "SELECT COUNT(*) AS count FROM summaries WHERE job_id IN (SELECT id FROM jobs WHERE id LIKE ? OR project_slug LIKE ? OR task_id LIKE ?)",
    args: (like) => [like, like, like]
  },
  {
    name: "telemetry_conflicts",
    deleteSql:
      "DELETE FROM telemetry_conflicts WHERE id LIKE ? OR stream_id LIKE ? OR project_slug LIKE ? OR task_id LIKE ? OR metadata_json LIKE ?",
    countSql:
      "SELECT COUNT(*) AS count FROM telemetry_conflicts WHERE id LIKE ? OR stream_id LIKE ? OR project_slug LIKE ? OR task_id LIKE ? OR metadata_json LIKE ?",
    args: (like, contains) => [like, like, like, like, contains]
  },
  {
    name: "telemetry_chunks",
    deleteSql:
      "DELETE FROM telemetry_chunks WHERE id LIKE ? OR source_id LIKE ? OR stream_id LIKE ? OR project_slug LIKE ? OR task_id LIKE ? OR metadata_json LIKE ?",
    countSql:
      "SELECT COUNT(*) AS count FROM telemetry_chunks WHERE id LIKE ? OR source_id LIKE ? OR stream_id LIKE ? OR project_slug LIKE ? OR task_id LIKE ? OR metadata_json LIKE ?",
    args: (like, contains) => [like, like, like, like, like, contains]
  },
  {
    name: "local_threads",
    deleteSql:
      "DELETE FROM local_threads WHERE id LIKE ? OR source_id LIKE ? OR project_slug LIKE ? OR thread_id LIKE ? OR linked_runner_job_id LIKE ? OR metadata_json LIKE ?",
    countSql:
      "SELECT COUNT(*) AS count FROM local_threads WHERE id LIKE ? OR source_id LIKE ? OR project_slug LIKE ? OR thread_id LIKE ? OR linked_runner_job_id LIKE ? OR metadata_json LIKE ?",
    args: (like, contains) => [like, like, like, like, like, contains]
  },
  {
    name: "processed_streams",
    deleteSql:
      "DELETE FROM processed_streams WHERE id LIKE ? OR project_slug LIKE ? OR stream_id LIKE ? OR linked_streams_json LIKE ? OR metadata_json LIKE ?",
    countSql:
      "SELECT COUNT(*) AS count FROM processed_streams WHERE id LIKE ? OR project_slug LIKE ? OR stream_id LIKE ? OR linked_streams_json LIKE ? OR metadata_json LIKE ?",
    args: (like, contains) => [like, like, like, contains, contains]
  },
  {
    name: "project_memory",
    deleteSql:
      "DELETE FROM project_memory WHERE id LIKE ? OR project_slug LIKE ? OR evidence_json LIKE ? OR metadata_json LIKE ?",
    countSql:
      "SELECT COUNT(*) AS count FROM project_memory WHERE id LIKE ? OR project_slug LIKE ? OR evidence_json LIKE ? OR metadata_json LIKE ?",
    args: (like, contains) => [like, like, contains, contains]
  },
  {
    name: "telemetry_streams",
    deleteSql:
      "DELETE FROM telemetry_streams WHERE id LIKE ? OR source_id LIKE ? OR project_slug LIKE ? OR stream_id LIKE ? OR task_id LIKE ? OR linked_job_id LIKE ? OR metadata_json LIKE ?",
    countSql:
      "SELECT COUNT(*) AS count FROM telemetry_streams WHERE id LIKE ? OR source_id LIKE ? OR project_slug LIKE ? OR stream_id LIKE ? OR task_id LIKE ? OR linked_job_id LIKE ? OR metadata_json LIKE ?",
    args: (like, contains) => [like, like, like, like, like, like, contains]
  },
  {
    name: "telemetry_sources",
    deleteSql:
      "DELETE FROM telemetry_sources WHERE id LIKE ? OR source_id LIKE ? OR project_slug LIKE ? OR metadata_json LIKE ?",
    countSql:
      "SELECT COUNT(*) AS count FROM telemetry_sources WHERE id LIKE ? OR source_id LIKE ? OR project_slug LIKE ? OR metadata_json LIKE ?",
    args: (like, contains) => [like, like, like, contains]
  },
  {
    name: "account_usage_snapshots",
    deleteSql:
      "DELETE FROM account_usage_snapshots WHERE id LIKE ? OR project_slug LIKE ? OR source_id LIKE ? OR metadata_json LIKE ?",
    countSql:
      "SELECT COUNT(*) AS count FROM account_usage_snapshots WHERE id LIKE ? OR project_slug LIKE ? OR source_id LIKE ? OR metadata_json LIKE ?",
    args: (like, contains) => [like, like, like, contains]
  },
  {
    name: "processing_runs",
    deleteSql:
      "DELETE FROM processing_runs WHERE id LIKE ? OR project_slug LIKE ? OR owner_id LIKE ? OR metadata_json LIKE ?",
    countSql:
      "SELECT COUNT(*) AS count FROM processing_runs WHERE id LIKE ? OR project_slug LIKE ? OR owner_id LIKE ? OR metadata_json LIKE ?",
    args: (like, contains) => [like, like, like, contains]
  },
  {
    name: "processing_leases",
    deleteSql: "DELETE FROM processing_leases WHERE id LIKE ? OR owner_id LIKE ? OR metadata_json LIKE ?",
    countSql: "SELECT COUNT(*) AS count FROM processing_leases WHERE id LIKE ? OR owner_id LIKE ? OR metadata_json LIKE ?",
    args: (like, contains) => [like, like, contains]
  },
  {
    name: "jobs",
    deleteSql: "DELETE FROM jobs WHERE id LIKE ? OR project_slug LIKE ? OR task_id LIKE ? OR summary_json LIKE ? OR status_json LIKE ?",
    countSql: "SELECT COUNT(*) AS count FROM jobs WHERE id LIKE ? OR project_slug LIKE ? OR task_id LIKE ? OR summary_json LIKE ? OR status_json LIKE ?",
    args: (like, contains) => [like, like, like, contains, contains]
  }
];

export async function onRequestOptions() {
  return cors(new Response(null, { status: 204 }));
}

export async function onRequestPost({ request, env }) {
  const auth = authenticateApiRequest(request, env);
  if (auth) {
    return cors(json(auth.body, auth.status));
  }
  if (!env.DB) {
    return cors(json({ error: "D1 binding DB is not configured" }, 500));
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return cors(json({ error: "Expected JSON body" }, 400));
  }

  const prefix = String(payload?.prefix || "").trim();
  const validation = validatePrefix(prefix);
  if (validation) {
    return cors(json({ error: validation }, 400));
  }

  const like = `${prefix}%`;
  const contains = `%${prefix}%`;
  const r2Keys = await r2KeysForPrefix(env, prefix, like, contains);
  const deleted = {};
  for (const table of cleanupTables) {
    const args = table.args(like, contains);
    const result = await env.DB.prepare(table.deleteSql).bind(...args).run();
    deleted[table.name] = result?.meta?.changes ?? result?.changes ?? null;
  }

  const r2Deleted = [];
  const r2Errors = [];
  if (env.RAW_TELEMETRY) {
    for (const key of r2Keys) {
      try {
        await env.RAW_TELEMETRY.delete(key);
        r2Deleted.push(key);
      } catch (error) {
        r2Errors.push({ key, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  const remaining = {};
  for (const table of cleanupTables) {
    const args = table.args(like, contains);
    const row = await env.DB.prepare(table.countSql).bind(...args).first();
    remaining[table.name] = Number(row?.count || 0);
  }
  const remainingTotal = Object.values(remaining).reduce((sum, value) => sum + value, 0);

  return cors(
    json({
      ok: remainingTotal === 0 && r2Errors.length === 0,
      prefix,
      deleted,
      r2ObjectsDeleted: r2Deleted.length,
      r2KeysDeleted: r2Deleted,
      r2Errors,
      remaining,
      remainingTotal
    })
  );
}

async function r2KeysForPrefix(env, prefix, like, contains) {
  const result = await env.DB.prepare(
    `SELECT r2_key
     FROM telemetry_chunks
     WHERE r2_key IS NOT NULL
       AND (id LIKE ? OR source_id LIKE ? OR stream_id LIKE ? OR project_slug LIKE ? OR task_id LIKE ? OR metadata_json LIKE ?)`
  )
    .bind(like, like, like, like, like, contains)
    .all();
  const keys = new Set((result.results || []).map((row) => row.r2_key).filter(Boolean));

  if (!env.RAW_TELEMETRY) {
    return Array.from(keys);
  }

  for (const streamKind of ["runner-job", "codex-thread", "workspace"]) {
    await collectListedR2Keys(env.RAW_TELEMETRY, `raw/v1/${streamKind}/${safePathSegment(prefix)}/`, keys);
  }
  return Array.from(keys).sort();
}

async function collectListedR2Keys(bucket, prefix, keys) {
  let cursor;
  do {
    const page = await bucket.list({ prefix, cursor });
    for (const object of page.objects || []) {
      keys.add(object.key);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

function validatePrefix(prefix) {
  if (!prefix) {
    return "prefix is required";
  }
  if (!/^live-test-\d{8}[Tt]\d{6}[Zz]-[a-z0-9][a-z0-9-]{3,}$/u.test(prefix)) {
    return "prefix must match live-test-YYYYMMDDTHHMMSSZ-shortid";
  }
  return null;
}

function safePathSegment(value) {
  return String(value || "unknown")
    .replace(/[^a-zA-Z0-9._=-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 160) || "unknown";
}
