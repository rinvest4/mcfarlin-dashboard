/**
 * POST /api/sync
 *
 * Receives status.json pushes from Mac Mini's auto-backup script.
 * Stores the latest status in KV so the dashboard reads from KV
 * instead of a static file (enabling real-time updates without redeploy).
 *
 * Auth: Bearer token (SYNC_SECRET env var) — Mac Mini includes this in the push.
 *
 * Request body: The full status.json payload
 * Response: { "ok": true, "received_at": "ISO timestamp" }
 *
 * Storage: Cloudflare KV namespace bound as DASHBOARD_DATA
 */

export async function onRequestPost(context) {
  const { request, env } = context;

  // Authenticate with shared secret
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");

  if (!env.SYNC_SECRET || token !== env.SYNC_SECRET) {
    return json({ error: "Unauthorized" }, 401);
  }

  let statusData;
  try {
    statusData = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  // Store in KV
  if (env.DASHBOARD_DATA) {
    await env.DASHBOARD_DATA.put("status", JSON.stringify(statusData));
    await env.DASHBOARD_DATA.put("last_sync", new Date().toISOString());
  }

  // Also merge any pending approvals from KV into the status for the next read
  if (env.APPROVALS) {
    const pendingRaw = await env.APPROVALS.get("pending");
    if (!pendingRaw) {
      // Initialize KV pending list from the pushed status.json
      const approvals = statusData.pending_approvals || [];
      await env.APPROVALS.put("pending", JSON.stringify(approvals));
    }
  }

  return json({
    ok: true,
    received_at: new Date().toISOString(),
    agents: statusData.summary
      ? statusData.summary.active_agents + " active"
      : "unknown",
  });
}

export async function onRequestGet(context) {
  const { env } = context;

  // Return the latest status from KV (or fall back to static status.json)
  if (env.DASHBOARD_DATA) {
    const data = await env.DASHBOARD_DATA.get("status");
    if (data) {
      return new Response(data, {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      });
    }
  }

  return json({ error: "No status data available. Waiting for first sync." }, 404);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
