import { Router } from 'express';
import { z } from 'zod';
import { notFound, validationError } from '../../lib/errors.js';
import { prisma } from '../../db/prisma.js';
import * as sched from '../../services/scheduler.js';
import * as approvals from '../../services/approvals.js';
import { resolveRecipient } from '../../services/outbound.js';
import { withIdempotency } from '../../services/idempotency.js';
import { serializeApproval, serializeScheduled } from '../../services/serializers.js';
import { settings } from '../../services/settings.js';
import { parseLocalDateTime } from '../../lib/time.js';
import type { Principal } from '../../services/permissions.js';
import { page, pagination, route } from '../route.js';

const idParam = z.object({ id: z.string().min(1).max(40) });
const src = (p: Principal) => (p.type === 'user' ? 'dashboard' : p.type === 'oauth' ? 'mcp' : 'api') as 'dashboard' | 'api' | 'mcp';

export function schedulingRoutes(r: Router) {
  route(r, {
    method: 'get', path: '/scheduled-messages', summary: 'List scheduled messages', tags: ['Scheduling'], capability: 'schedule:read',
    query: z.object({ account_id: z.string().max(40).optional(), status: z.string().max(120).optional(), ...pagination }),
    handler: async ({ principal, query }) => {
      const res = await sched.listScheduled(principal, { accountId: query.account_id, status: query.status, limit: query.limit, offset: query.offset });
      return page(res.items, res.total, query.limit, query.offset);
    },
  });

  route(r, {
    method: 'post', path: '/scheduled-messages', summary: 'Schedule a message', description: 'scheduled_at is ISO 8601. Without an offset it is interpreted in `timezone`. Integrations that require approval create the message in awaiting_approval state.', tags: ['Scheduling'], capability: 'schedule:write', status: 201, idempotent: true,
    body: z.object({
      account_id: z.string().min(1).max(40),
      chat_id: z.string().max(160).optional(),
      phone_number: z.string().max(32).optional(),
      contact_id: z.string().max(40).optional(),
      name: z.string().max(120).optional(),
      text: z.string().max(4096).optional(),
      attachment_id: z.string().max(40).optional(),
      scheduled_at: z.string().min(10).max(40),
      timezone: z.string().max(64).optional(),
    }),
    handler: async ({ req, res, principal, body }) => {
      const out = await withIdempotency(`${principal.type}:${principal.id}`, req.get('idempotency-key') ?? undefined, body, async () => {
        const tz = body.timezone ?? principal.timezone ?? settings().defaultTimezone;
        const resolved = await resolveRecipient(body.account_id, { chat_id: body.chat_id, phone_number: body.phone_number, contact_id: body.contact_id, name: body.name });
        if (body.attachment_id && !(await prisma().messageAttachment.findFirst({ where: { id: body.attachment_id, accountId: body.account_id, state: 'STORED' } }))) throw notFound('Attachment');
        const row = await sched.createScheduled(principal, { accountId: body.account_id, recipientWaId: resolved.waChatId, recipientLabel: resolved.label, body: body.text ?? null, attachmentId: body.attachment_id ?? null, scheduledAt: parseLocalDateTime(body.scheduled_at, tz), timezone: tz }, src(principal));
        return { status: 201, body: serializeScheduled(row) };
      });
      res.status(out.status).json({ data: out.body });
    },
  });

  route(r, {
    method: 'get', path: '/scheduled-messages/:id', summary: 'Get a scheduled message', tags: ['Scheduling'], params: idParam,
    handler: async ({ principal, params }) => serializeScheduled(await sched.getScheduled(principal, params.id)),
  });

  route(r, {
    method: 'patch', path: '/scheduled-messages/:id', summary: 'Edit or reschedule a pending message', tags: ['Scheduling'], params: idParam,
    body: z.object({ text: z.string().max(4096).nullable().optional(), attachment_id: z.string().max(40).nullable().optional(), scheduled_at: z.string().min(10).max(40).optional(), timezone: z.string().max(64).optional() }),
    handler: async ({ principal, params, body }) => {
      const existing = await sched.getScheduled(principal, params.id);
      const tz = body.timezone ?? existing.timezone;
      if (!Object.keys(body).length) throw validationError('Nothing to update');
      const row = await sched.updateScheduled(principal, params.id, {
        ...(body.text !== undefined ? { body: body.text } : {}),
        ...(body.attachment_id !== undefined ? { attachmentId: body.attachment_id } : {}),
        ...(body.scheduled_at ? { scheduledAt: parseLocalDateTime(body.scheduled_at, tz) } : {}),
        ...(body.timezone ? { timezone: body.timezone } : {}),
      }, src(principal));
      return serializeScheduled(row);
    },
  });

  route(r, {
    method: 'delete', path: '/scheduled-messages/:id', summary: 'Cancel a scheduled message', tags: ['Scheduling'], params: idParam,
    handler: async ({ principal, params }) => serializeScheduled(await sched.cancelScheduled(principal, params.id, src(principal))),
  });

  // ───────────── approvals ─────────────
  route(r, {
    method: 'get', path: '/approvals', summary: 'List message approval requests', tags: ['Approvals'], auth: 'session', capability: 'approvals:review',
    query: z.object({ status: z.enum(['pending', 'approved', 'rejected', 'superseded', 'executed', 'failed']).optional(), account_id: z.string().max(40).optional(), ...pagination }),
    handler: async ({ principal, query }) => {
      const res = await approvals.listApprovals(principal, { status: query.status, accountId: query.account_id, limit: query.limit, offset: query.offset });
      return page(res.items, res.total, query.limit, query.offset);
    },
  });

  route(r, {
    method: 'get', path: '/approvals/:id', summary: 'Get an approval request (requesters may read their own)', tags: ['Approvals'], params: idParam,
    handler: async ({ principal, params }) => serializeApproval(await approvals.getApprovalFor(principal, params.id)),
  });

  for (const decision of ['approve', 'reject'] as const) {
    route(r, {
      method: 'post', path: `/approvals/:id/${decision}`, summary: `${decision === 'approve' ? 'Approve' : 'Reject'} an approval request`, tags: ['Approvals'], auth: 'session', capability: 'approvals:review', params: idParam,
      body: z.object({ note: z.string().max(500).optional() }),
      handler: async ({ principal, params, body }) => serializeApproval(await approvals.decide(principal, params.id, decision, body.note)),
    });
  }
}
