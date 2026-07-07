/**
 * gmail-drafts.ts — Create/update Gmail drafts via the Gmail REST API.
 *
 * Used by generate-outreach-email.ts to materialize outreach copy as a real
 * draft in the sender's Drafts folder for human review. This module NEVER
 * sends mail — only drafts.create and drafts.update are called.
 *
 * Auth: pass a domain-wide-delegated user token from
 * getDelegatedUserAccessToken(sender, [GMAIL_COMPOSE_SCOPE]).
 *
 * No deps: builds the RFC 2822 message by hand (UTF-8-safe via base64
 * transfer encoding + RFC 2047 subject encoding).
 */

const GMAIL_DRAFTS_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/drafts';

// Narrowest scope that can create drafts (no drafts-only scope exists).
export const GMAIL_COMPOSE_SCOPE = 'https://www.googleapis.com/auth/gmail.compose';

export interface DraftContent {
  to?: string;
  from: string;
  subject: string;
  body: string;
}

/** Error carrying the HTTP status so callers can fall back on 404. */
export class GmailApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'GmailApiError';
  }
}

function base64Utf8(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64');
}

function buildRawMessage(c: DraftContent): string {
  const headers: string[] = [];
  headers.push(`From: ${c.from}`);
  if (c.to && c.to.trim()) headers.push(`To: ${c.to.trim()}`);
  // RFC 2047 B-encoding keeps any non-ASCII subject intact.
  headers.push(`Subject: =?UTF-8?B?${base64Utf8(c.subject)}?=`);
  headers.push('MIME-Version: 1.0');
  headers.push('Content-Type: text/plain; charset="UTF-8"');
  headers.push('Content-Transfer-Encoding: base64');

  // Base64 body lines wrapped at 76 chars per RFC 2045.
  const bodyB64 = base64Utf8(c.body).replace(/(.{76})/g, '$1\r\n');

  const message = headers.join('\r\n') + '\r\n\r\n' + bodyB64;

  return Buffer.from(message, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function draftRequest(
  accessToken: string,
  method: 'POST' | 'PUT',
  url: string,
  raw: string,
): Promise<string> {
  const resp = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: { raw } }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new GmailApiError(
      `Gmail drafts ${method} failed (${resp.status}): ${errText}`,
      resp.status,
    );
  }

  const data = await resp.json();
  return data.id as string;
}

/** Create a new draft. Returns the Gmail draft id. */
export async function createDraft(
  accessToken: string,
  content: DraftContent,
): Promise<string> {
  return draftRequest(accessToken, 'POST', GMAIL_DRAFTS_URL, buildRawMessage(content));
}

/**
 * Update an existing draft in place. Returns the (possibly unchanged) draft id.
 * Throws GmailApiError with status 404 if the draft was deleted in Gmail —
 * callers should fall back to createDraft.
 */
export async function updateDraft(
  accessToken: string,
  draftId: string,
  content: DraftContent,
): Promise<string> {
  return draftRequest(
    accessToken,
    'PUT',
    `${GMAIL_DRAFTS_URL}/${encodeURIComponent(draftId)}`,
    buildRawMessage(content),
  );
}
