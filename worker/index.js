const PLURK_API = 'https://www.plurk.com/APP';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }
    const url = new URL(request.url);
    try {
      if (request.method === 'POST' && url.pathname === '/save') return await handleSave(request, env);
      if (request.method === 'GET' && url.pathname === '/get') return await handleGet(request, env);
      if (request.method === 'GET' && url.pathname === '/debug') return await handleDebug(request, env);
      return jsonError('找不到此路由', 404);
    } catch (e) {
      console.error('ERROR:', e.message, e.stack);
      return jsonError(e.message || '伺服器錯誤', 500);
    }
  },
};

// ── Debug endpoint ────────────────────────────────────────────────────────────
async function handleDebug(request, env) {
  const url = new URL(request.url);
  const plurk_id = url.searchParams.get('plurk_id');
  const owner_id = url.searchParams.get('owner_id');

  if (owner_id) {
    // Test profile fetch
    const r1 = await plurkApiGet(env, 'Profile/getPublicProfile', { user_id: owner_id });
    const r2 = await plurkApiGet(env, 'Profile/getPublicProfile', { user_id: String(owner_id) });
    const r3 = await plurkApiGet(env, 'Profile/getPublicProfile', { user_id: owner_id });
    return jsonOk({ user_id_used: owner_id, getPublicProfile: r1, getPublicProfile_str: r2, FriendsFans: r3 });
  }

  if (plurk_id) {
    const numericId = toNumericId(plurk_id);
    const raw = await plurkApiGet(env, 'Timeline/getPlurk', { plurk_id: numericId });
    return jsonOk({ numeric_id: numericId, raw_response: raw });
  }

  return jsonError('需要 plurk_id 或 owner_id 參數', 400);
}

function toNumericId(id) {
  if (/^\d+$/.test(String(id))) return String(id);
  return String(parseInt(String(id), 36));
}

async function handleSave(request, env) {
  const body = await request.json().catch(() => ({}));
  const { plurk_id } = body;
  if (!plurk_id) return jsonError('缺少 plurk_id', 400);

  const numericId = toNumericId(plurk_id);
  const existing = await kvGet(env, plurk_id);

  const plurkData = await plurkApiGet(env, 'Timeline/getPlurk', { plurk_id: numericId });

  if (plurkData.error_text) {
    if (existing) {
      existing.is_deleted = true;
      await kvSet(env, plurk_id, existing);
      return jsonOk(existing);
    }
    return jsonError('找不到此噗文，可能已被刪除或為私密噗', 404);
  }

  const plurk = plurkData.plurk;
  if (!plurk) return jsonError('API 回傳格式異常', 500);

  // Try to find owner from users map first
  const usersMap = plurkData.user ?? plurkData.users ?? {};
  let ownerRaw = usersMap[String(plurk.owner_id)] ?? null;

  // Fallback: fetch profile directly
  if (!ownerRaw && plurk.owner_id) {
    const profileData = await plurkApiGet(env, 'Profile/getPublicProfile', {
      user_id: String(plurk.owner_id),
    });
    // Try different possible response shapes
    ownerRaw = profileData?.user_info
      ?? profileData?.user
      ?? (profileData?.id ? profileData : null);
  }

  // 抓 responses
  const respData = await plurkApiGet(env, 'Responses/get', {
    plurk_id: numericId,
    from_response: 0,
  });

  const owner = ownerRaw ? {
    display_name: ownerRaw.display_name ?? ownerRaw.full_name ?? ownerRaw.nick_name ?? '',
    nick_name:    ownerRaw.nick_name ?? '',
    avatar_url:   avatarUrl(ownerRaw),
  } : (existing?.owner ?? null);

  const newResponses = buildResponses(
    respData?.responses ?? [],
    respData?.friends ?? {}
  );

  const mergedResponses = existing?.responses ? [...existing.responses] : [];
  for (const newResp of newResponses) {
    const existIdx = mergedResponses.findIndex(r => 
      (r.id && newResp.id && r.id === newResp.id) || 
      (!r.id && r.posted === newResp.posted && r.content === newResp.content)
    );
    if (existIdx >= 0) {
      const existingResp = mergedResponses[existIdx];
      const history = existingResp.history ? [...existingResp.history] : [];
      if (existingResp.content && existingResp.content !== newResp.content) {
        history.push({
          content: existingResp.content,
          updated_at: existing?.updated_at ?? new Date().toISOString()
        });
      }
      newResp.history = history;
      mergedResponses[existIdx] = newResp;
    } else {
      newResp.history = [];
      mergedResponses.push(newResp);
    }
  }
  mergedResponses.sort((a, b) => new Date(a.posted).getTime() - new Date(b.posted).getTime());

  const newPlurkContent = plurk.content_raw ?? plurk.content ?? '';
  const plurkHistory = existing?.plurk?.history ? [...existing.plurk.history] : [];
  if (existing?.plurk?.content && existing.plurk.content !== newPlurkContent) {
    plurkHistory.push({
      content: existing.plurk.content,
      updated_at: existing.updated_at
    });
  }

  const record = {
    plurk_id,
    numeric_id: numericId,
    plurk: {
      content:   newPlurkContent,
      qualifier: plurk.qualifier,
      posted:    plurk.posted,
      owner_id:  plurk.owner_id,
      history:   plurkHistory,
    },
    owner,
    responses: mergedResponses,
    saved_at:   existing?.saved_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
    is_deleted: false,
  };

  await kvSet(env, plurk_id, record);
  return jsonOk(record);
}

async function handleGet(request, env) {
  const url = new URL(request.url);
  const plurk_id = url.searchParams.get('plurk_id');
  if (!plurk_id) return jsonError('缺少 plurk_id', 400);
  const record = await kvGet(env, plurk_id);
  if (!record) return jsonError('找不到此存檔，請先建立存檔', 404);
  return jsonOk(record);
}

function percentEncode(str) {
  return encodeURIComponent(String(str))
    .replace(/!/g, '%21').replace(/'/g, '%27')
    .replace(/\(/g, '%28').replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

async function hmacSha1(key, data) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function buildOAuthHeader(env, method, url, extraParams = {}) {
  const oauthParams = {
    oauth_consumer_key:     env.PLURK_APP_KEY,
    oauth_token:            env.PLURK_ACCESS_TOKEN,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp:        String(Math.floor(Date.now() / 1000)),
    oauth_nonce:            Math.random().toString(36).substring(2),
    oauth_version:          '1.0',
  };

  const allParams = { ...oauthParams, ...extraParams };
  const sortedParams = Object.keys(allParams)
    .sort()
    .map(k => `${percentEncode(k)}=${percentEncode(allParams[k])}`)
    .join('&');

  const signingKey = `${percentEncode(env.PLURK_APP_SECRET)}&${percentEncode(env.PLURK_ACCESS_SECRET)}`;
  const baseString = `${method}&${percentEncode(url)}&${percentEncode(sortedParams)}`;
  const signature = await hmacSha1(signingKey, baseString);
  oauthParams.oauth_signature = signature;

  return 'OAuth ' + Object.keys(oauthParams)
    .map(k => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
    .join(', ');
}

async function plurkApiGet(env, endpoint, params = {}) {
  const url = `${PLURK_API}/${endpoint}`;
  const authHeader = await buildOAuthHeader(env, 'GET', url, params);
  const qs = new URLSearchParams(params);
  const res = await fetch(`${url}?${qs}`, {
    headers: { Authorization: authHeader },
  });
  return res.json();
}

function buildResponses(responses, friends) {
  return responses.map(r => {
    const user = friends[String(r.user_id)] ?? {};
    return {
      id:           r.id,
      display_name: user.display_name ?? user.nick_name ?? '?',
      nick_name:    user.nick_name ?? '',
      avatar_url:   avatarUrl(user),
      qualifier:    r.qualifier,
      content:      r.content_raw ?? r.content ?? '',
      posted:       r.posted,
    };
  });
}

function avatarUrl(user) {
  if (!user?.id) return null;
  const avatar = user.avatar ?? 0;
  if (avatar === 0) return `https://avatars.plurk.com/${user.id}-small.jpg`;
  return `https://avatars.plurk.com/${user.id}-small${avatar}.jpg`;
}

async function kvGet(env, plurkId) {
  const val = await env.PLURK_ARCHIVE.get(`plurk:${plurkId}`);
  if (!val) return null;
  try { return JSON.parse(val); } catch { return null; }
}

async function kvSet(env, plurkId, data) {
  await env.PLURK_ARCHIVE.put(`plurk:${plurkId}`, JSON.stringify(data));
}

function jsonOk(data) {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function jsonError(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}