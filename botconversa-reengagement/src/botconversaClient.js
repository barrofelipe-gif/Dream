// Wrapper fino sobre os endpoints do BotConversa confirmados no Swagger
// (https://backend.botconversa.com.br/swagger/). Cada função corresponde
// a um endpoint real listado lá — nada aqui foi inventado.

import { config } from './config.js';

function authHeaders() {
  return {
    [config.authHeaderName]: `${config.authHeaderPrefix}${config.apiKey}`,
    'Content-Type': 'application/json',
  };
}

async function request(method, path, body) {
  const url = `${config.apiBase}${path}`;
  const res = await fetch(url, {
    method,
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`BotConversa API ${method} ${path} -> ${res.status}: ${text}`);
  }

  // Nem toda resposta tem corpo (ex: DELETE costuma vir vazio).
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// GET /subscriber/get_by_phone/{phone}/ — Find subscriber by phone
export function getSubscriberByPhone(phone) {
  return request('GET', `/subscriber/get_by_phone/${encodeURIComponent(phone)}/`);
}

// POST /subscriber/{subscriber_id}/send_message/ — Send message to subscriber
// Corpo confirmado no Swagger: { "type": "text" | "file", "value": "..." }
export function sendMessage(subscriberId, text) {
  return request('POST', `/subscriber/${subscriberId}/send_message/`, { type: 'text', value: text });
}

// POST /subscriber/{subscriber_id}/tags/{tag_id}/ — Add tag to subscriber
export function addTag(subscriberId, tagId) {
  return request('POST', `/subscriber/${subscriberId}/tags/${tagId}/`);
}

// DELETE /subscriber/{subscriber_id}/tags/{tag_id}/ — Remove tag from subscriber
export function removeTag(subscriberId, tagId) {
  return request('DELETE', `/subscriber/${subscriberId}/tags/${tagId}/`);
}

// GET /tags/ — Retrieve list of tags (útil pra descobrir o ID da tag "sem-resposta")
export function listTags() {
  return request('GET', '/tags/');
}
