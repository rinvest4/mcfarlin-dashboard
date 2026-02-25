/**
 * POST /api/approve
 *
 * Handles approval/rejection of pending items.
 * Authenticated via Cloudflare Access (JWT in CF_Authorization cookie).
 *
 * Request body:
 *   { "id": "item-id", "action": "approve"|"reject", "note": "optional comment" }
 *
 * Response:
 *   { "ok": true, "id": "item-id", "action": "approve", "by": "user@email.com", "at": "ISO timestamp" }
 *
 * Storage: Cloudflare KV namespace bound as APPROVALS
 */

export async function onRequestPost(context) {
  const { request, env } = context;

  // Verify Cloudflare Access JWT
  const email = await getAuthenticatedEmail(request);
  if (!email) {
    return json({ error: "Unauthorized" }, 401);
  }

  // Only allow known approvers
  const ALLOWED_APPROVERS = [
    "rinvest4@gmail.com",
    "amandalastudios@gmail.com",
  ];
  if (!ALLOWED_APPROVERS.includes(email.toLowerCase())) {
    return json({ error: "Forbidden — not an authorized approver" }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { id, action, note } = body;
  if (!id || !action) {
    return json({ error: "Missing required fields: id, action" }, 400);
  }
  if (!["approve", "reject"].includes(action)) {
    return json({ error: 'action must be "approve" or "reject"' }, 400);
  }

  const decision = {
    id,
    action,
    note: note || "",
    by: email,
    at: new Date().toISOString(),
  };

  // Store in KV if available
  if (env.APPROVALS) {
    await env.APPROVALS.put(`decision:${id}`, JSON.stringify(decision));

    // Remove from pending list
    const pendingRaw = await env.APPROVALS.get("pending");
    if (pendingRaw) {
      const pending = JSON.parse(pendingRaw);
      const updated = pending.filter((item) => item.id !== id);
      await env.APPROVALS.put("pending", JSON.stringify(updated));
    }

    // Add to history
    const historyRaw = await env.APPROVALS.get("history");
    const history = historyRaw ? JSON.parse(historyRaw) : [];
    history.unshift(decision);
    // Keep last 100 decisions
    await env.APPROVALS.put(
      "history",
      JSON.stringify(history.slice(0, 100))
    );
  }

  return json({ ok: true, ...decision });
}

export async function onRequestGet(context) {
  const { request, env } = context;

  const email = await getAuthenticatedEmail(request);
  if (!email) {
    return json({ error: "Unauthorized" }, 401);
  }

  // Return pending approvals and recent history
  if (!env.APPROVALS) {
    return json({ pending: [], history: [] });
  }

  const pendingRaw = await env.APPROVALS.get("pending");
  const historyRaw = await env.APPROVALS.get("history");

  return json({
    pending: pendingRaw ? JSON.parse(pendingRaw) : [],
    history: historyRaw ? JSON.parse(historyRaw) : [],
  });
}

// ─── Helpers ────────────────────────────────────────────

async function getAuthenticatedEmail(request) {
  // Cloudflare Access sets CF_Authorization cookie with a JWT
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/CF_Authorization=([^;]+)/);
  if (!match) return null;

  try {
    // Decode JWT payload (Cloudflare Access already validated it)
    const payload = JSON.parse(atob(match[1].split(".")[1]));
    return payload.email || null;
  } catch {
    return null;
  }
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
