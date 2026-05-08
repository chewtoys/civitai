import type { NextApiRequest, NextApiResponse } from 'next';
import { env } from '~/env/server';
import { getServerAuthSession } from '~/server/auth/get-server-auth-session';
import { dbRead } from '~/server/db/client';
import { createImageIngestionRequest } from '~/server/services/orchestrator/orchestrator.service';
import type { MediaType } from '~/shared/utils/prisma/enums';

/**
 * GET /api/image/ingest/:imageId
 *
 * Re-ingests an image through the orchestrator. Intended as a debugging tool for
 * moderators and orchestrator devs.
 *
 * Auth: pass `?token=$WEBHOOK_TOKEN` OR be signed in as a moderator.
 *
 * On orchestrator failure, returns `{ error, status, body }` so the caller can
 * inspect the exact request body that was submitted.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const tokenAuthed = !!req.query.token && req.query.token === env.WEBHOOK_TOKEN;
  if (!tokenAuthed) {
    const session = await getServerAuthSession({ req, res });
    if (!session?.user?.isModerator || session.user.bannedAt) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const imageId = Number(req.query.imageId);
  if (!Number.isFinite(imageId)) {
    return res.status(400).json({ error: 'Invalid imageId' });
  }

  const image = await dbRead.image.findUnique({
    where: { id: imageId },
    select: { id: true, url: true, type: true },
  });
  if (!image) return res.status(404).json({ error: 'Image not found' });

  const callbackUrl =
    env.IMAGE_SCANNING_CALLBACK ??
    `${env.NEXTAUTH_URL}/api/webhooks/image-scan-result?token=${env.WEBHOOK_TOKEN}`;

  try {
    const { data, body, error, status } = await createImageIngestionRequest({
      imageId: image.id,
      url: image.url,
      type: image.type as MediaType,
      callbackUrl,
    });
    if (!data) {
      return res.status(502).json({ error: error ?? 'Ingestion request failed', status, body });
    }
    return res.status(200).json({ workflowId: data.id });
  } catch (e) {
    const err = e as Error;
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
}
