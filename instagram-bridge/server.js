import express from "express";
import fs from "fs";
import path from "path";
import { IgApiClient } from "instagram-private-api";

const app = express();
app.use(express.json());

const port = Number(process.env.INSTAGRAM_BRIDGE_PORT || 8091);
const sessionsDir = path.resolve(process.env.INSTAGRAM_BRIDGE_SESSIONS_DIR || "./sessions");

if (!fs.existsSync(sessionsDir)) {
  fs.mkdirSync(sessionsDir, { recursive: true });
}

function sessionFile(instanceId) {
  return path.join(sessionsDir, `${instanceId}.json`);
}

function metaFile(instanceId) {
  return path.join(sessionsDir, `${instanceId}.meta.json`);
}

function loadMeta(instanceId) {
  const file = metaFile(instanceId);
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return {}; }
}

function saveMeta(instanceId, data) {
  fs.writeFileSync(metaFile(instanceId), JSON.stringify(data));
}

function ok(data) {
  return { success: true, data };
}

function fail(res, status, error) {
  return res.status(status).json({ success: false, error });
}

function mapIgError(err) {
  const raw = String(err?.message || err || "");

  if (/incorrect.*password|password.*incorrect|wrong password/i.test(raw))
    return "Senha incorreta. Verifique e tente novamente.";
  if (/username.*doesn.*belong|no account found|user.*not found/i.test(raw))
    return "Usuário não encontrado no Instagram.";
  if (/account.*disabled|account.*suspended|account.*banned/i.test(raw))
    return "Conta desativada ou banida pelo Instagram.";
  if (/wait a few minutes|too many requests|rate.?limit|try again later/i.test(raw))
    return "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.";
  if (/unusual.*login|suspicious|unusual.*attempt/i.test(raw))
    return "Login bloqueado por atividade suspeita. Acesse o app do Instagram e aprove o login.";
  if (/two.?factor|2fa|two.?step/i.test(raw))
    return "Autenticação de dois fatores ativada. Use o código do app autenticador.";
  if (/checkpoint|challenge/i.test(raw))
    return "Instagram exigiu verificação de segurança. Verifique seu e-mail ou celular.";
  if (/feedback_required/i.test(raw))
    return "Instagram bloqueou esta ação temporariamente. Tente novamente mais tarde ou use um proxy.";
  if (/consent_required/i.test(raw))
    return "Instagram requer aceite de novos termos. Acesse o app e aceite os termos de uso.";
  if (/Please wait/i.test(raw))
    return "Instagram pediu para aguardar. Tente novamente em alguns minutos.";
  if (/invalid.*code|code.*invalid|wrong.*code/i.test(raw))
    return "Código de verificação inválido. Verifique e tente novamente.";
  if (/code.*expired|expired.*code/i.test(raw))
    return "Código de verificação expirado. Solicite um novo código.";
  if (/proxy|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(raw))
    return "Falha na conexão com o proxy. Verifique as configurações do servidor.";

  // Extract the human-readable part after the HTTP status line if present
  // e.g. "POST /api/v1/... - 400 Bad Request; The password you entered..."
  const afterSemicolon = raw.match(/;\s*(.+)$/);
  if (afterSemicolon) return afterSemicolon[1].trim();

  return raw || "Erro desconhecido ao conectar com o Instagram.";
}

async function buildClient(instanceId, username) {
  const ig = new IgApiClient();
  ig.state.generateDevice(username);

  const file = sessionFile(instanceId);
  if (fs.existsSync(file)) {
    const state = JSON.parse(fs.readFileSync(file, "utf-8"));
    await ig.state.deserialize(state);
  }

  // Apply proxy stored in meta (set during login from the server's proxy config)
  const meta = loadMeta(instanceId);
  if (meta.proxy) {
    ig.state.proxyUrl = meta.proxy;
  }

  return ig;
}

async function persistState(ig, instanceId) {
  const state = await ig.state.serialize();
  delete state.constants;
  fs.writeFileSync(sessionFile(instanceId), JSON.stringify(state));
}

app.get("/health", (_req, res) => {
  res.json(ok({ service: "instagram-bridge", version: "1.0.0" }));
});

app.post("/instagram/login", async (req, res) => {
  try {
    const { instance_id: instanceId, username, password, proxy } = req.body || {};
    if (!instanceId || !username || !password) {
      return fail(res, 400, "instance_id, username e password são obrigatórios");
    }

    // Persist proxy config before building client so it's applied immediately
    if (proxy) {
      saveMeta(instanceId, { proxy });
    }

    const ig = await buildClient(instanceId, username);

    try {
      await ig.account.login(username, password);
    } catch (loginErr) {
      // Check if it's a challenge (2FA, email verification, etc.)
      if (loginErr?.response?.challenge?.api_path) {
        const challenge = loginErr.response.challenge;
        await persistState(ig, instanceId);

        let challengeType = "code";
        let challengeOptions = [];

        try {
          const challengeData = await ig.challenge.selectVerifyMethod(challenge.api_path, false);
          if (challengeData?.choice) {
            challengeType = challengeData.choice === 1 ? "email" : "phone";
          }
          if (challengeData?.extraData?.choice) {
            if (challengeData.extraData.email) challengeOptions.push("email");
            if (challengeData.extraData.phone) challengeOptions.push("phone");
          }
        } catch (_e) {
          // Continue with basic challenge info
        }

        return res.json(ok({
          status: "challenge_required",
          challenge_type: challengeType,
          options: challengeOptions.length > 0 ? challengeOptions : ["email", "phone"],
          api_path: challenge.api_path,
          instance_id: instanceId,
          username: username,
        }));
      }

      const msg = String(loginErr?.message || "");
      if (msg.includes("We can send you an email") || msg.includes("help you get back into your account")) {
        return res.json(ok({
          status: "challenge_required",
          challenge_type: "email_recovery",
          options: ["email"],
          api_path: "",
          instance_id: instanceId,
          username: username,
          message: "Instagram exige verificação no app/email antes de concluir o login pela API",
        }));
      }

      throw loginErr;
    }

    await persistState(ig, instanceId);

    const me = await ig.account.currentUser();
    return res.json(ok({
      username: me.username,
      pk: Number(me.pk),
      profile_pic_url: me.profile_pic_url,
      status: "connected",
    }));
  } catch (err) {
    return fail(res, 502, mapIgError(err));
  }
});

// Instagram challenge verification endpoint
app.post("/instagram/challenge", async (req, res) => {
  try {
    const { instance_id: instanceId, username, api_path, code } = req.body || {};
    if (!instanceId || !username || !api_path || !code) {
      return fail(res, 400, "instance_id, username, api_path e code são obrigatórios");
    }

    const ig = await buildClient(instanceId, username);

    // Restore checkpoint so sendVerifyCode knows which api_path to POST to
    ig.state.checkpoint = { api_path };

    await ig.challenge.sendVerifyCode(code);
    await persistState(ig, instanceId);

    const me = await ig.account.currentUser();
    return res.json(ok({
      username: me.username,
      pk: Number(me.pk),
      profile_pic_url: me.profile_pic_url,
      status: "connected",
    }));
  } catch (err) {
    return fail(res, 502, mapIgError(err));
  }
});

// Resend challenge code
app.post("/instagram/challenge/resend", async (req, res) => {
  try {
    const { instance_id: instanceId, username, api_path } = req.body || {};
    if (!instanceId || !username || !api_path) {
      return fail(res, 400, "instance_id, username e api_path são obrigatórios");
    }

    const ig = await buildClient(instanceId, username);

    // replay_challenge=1 triggers Instagram to resend the code
    await ig.challenge.selectVerifyMethod(api_path, true);
    await persistState(ig, instanceId);

    return res.json(ok({ message: "código reenviado" }));
  } catch (err) {
    return fail(res, 502, mapIgError(err));
  }
});

app.post("/instagram/logout", async (req, res) => {
  const { instance_id: instanceId } = req.body || {};
  if (!instanceId) return fail(res, 400, "instance_id é obrigatório");

  const file = sessionFile(instanceId);
  if (fs.existsSync(file)) fs.unlinkSync(file);

  const mf = metaFile(instanceId);
  if (fs.existsSync(mf)) fs.unlinkSync(mf);

  return res.json(ok({ status: "disconnected" }));
});

app.post("/instagram/dm/send", async (req, res) => {
  try {
    const { instance_id: instanceId, username, recipient, message } = req.body || {};
    if (!instanceId || !username || !recipient || !message) {
      return fail(res, 400, "instance_id, username, recipient e message são obrigatórios");
    }

    const ig = await buildClient(instanceId, username);
    const userId = await ig.user.getIdByUsername(recipient);
    const thread = ig.entity.directThread([String(userId)]);
    const sent = await thread.broadcastText(message);
    await persistState(ig, instanceId);

    return res.json(ok({
      message_id: Number(sent?.item_id || 0),
      thread_id: Number(sent?.thread_id || 0),
      status: "sent",
    }));
  } catch (err) {
    return fail(res, 502, err?.message || "send dm failed");
  }
});

app.get("/instagram/dm/read", async (req, res) => {
  try {
    const instanceId = req.query.instance_id;
    const username = req.query.username;
    if (!instanceId || !username) {
      return fail(res, 400, "instance_id e username são obrigatórios");
    }

    const ig = await buildClient(String(instanceId), String(username));
    const inboxFeed = ig.feed.directInbox();
    const threads = await inboxFeed.items();

    const payload = threads.map((thread) => ({
      thread_id: Number(thread.thread_id),
      messages: (thread.items || []).map((item) => ({
        message_id: Number(item.item_id || 0),
        user_id: Number(item.user_id || 0),
        text: item.text || "",
        timestamp: Number(item.timestamp || 0),
        item_type: item.item_type || "text",
      })),
      users: {},
    }));

    await persistState(ig, String(instanceId));
    return res.json(ok({ threads: payload }));
  } catch (err) {
    return fail(res, 502, err?.message || "read inbox failed");
  }
});

app.post("/instagram/follow", async (req, res) => {
  try {
    const { instance_id: instanceId, username, target } = req.body || {};
    if (!instanceId || !username || !target) {
      return fail(res, 400, "instance_id, username e target são obrigatórios");
    }

    const ig = await buildClient(instanceId, username);
    const userId = await ig.user.getIdByUsername(target);
    await ig.friendship.create(userId);
    await persistState(ig, instanceId);

    return res.json(ok({ status: "ok", target }));
  } catch (err) {
    return fail(res, 502, err?.message || "follow failed");
  }
});

app.post("/instagram/unfollow", async (req, res) => {
  try {
    const { instance_id: instanceId, username, target } = req.body || {};
    if (!instanceId || !username || !target) {
      return fail(res, 400, "instance_id, username e target são obrigatórios");
    }

    const ig = await buildClient(instanceId, username);
    const userId = await ig.user.getIdByUsername(target);
    await ig.friendship.destroy(userId);
    await persistState(ig, instanceId);

    return res.json(ok({ status: "ok", target }));
  } catch (err) {
    return fail(res, 502, err?.message || "unfollow failed");
  }
});

app.get("/instagram/profile", async (req, res) => {
  try {
    const instanceId = req.query.instance_id;
    const username = req.query.username;
    const target = req.query.target;
    if (!instanceId || !username || !target) {
      return fail(res, 400, "instance_id, username e target são obrigatórios");
    }

    const ig = await buildClient(String(instanceId), String(username));
    const userId = await ig.user.getIdByUsername(String(target));
    const info = await ig.user.info(userId);
    await persistState(ig, String(instanceId));

    return res.json(ok({
      pk: Number(info.pk),
      username: info.username,
      full_name: info.full_name,
      profile_pic_url: info.profile_pic_url,
      is_private: Boolean(info.is_private),
      follower_count: Number(info.follower_count || 0),
      following_count: Number(info.following_count || 0),
    }));
  } catch (err) {
    return fail(res, 502, err?.message || "profile lookup failed");
  }
});

app.post("/instagram/post", async (req, res) => {
  try {
    const { instance_id: instanceId, username, image_url, video_url, caption } = req.body || {};
    if (!instanceId || !username || (!image_url && !video_url)) {
      return fail(res, 400, "instance_id, username e (image_url ou video_url) são obrigatórios");
    }

    const ig = await buildClient(instanceId, username);
    let mediaId;

    if (video_url) {
      const videoRes = await ig.media.uploadVideo({ videoUrl: video_url });
      mediaId = videoRes.id;
      if (caption) {
        await ig.media.configure({ mediaId, caption });
      }
    } else {
      const photoRes = await ig.media.uploadPhoto({ photoUrl: image_url });
      mediaId = photoRes.id;
      if (caption) {
        await ig.media.configure({ mediaId, caption });
      }
    }

    await persistState(ig, instanceId);
    return res.json(ok({ media_id: mediaId, status: "posted", url: `https://instagram.com/p/${mediaId}` }));
  } catch (err) {
    return fail(res, 502, err?.message || "post failed");
  }
});

app.post("/instagram/story", async (req, res) => {
  try {
    const { instance_id: instanceId, username, image_url, video_url, caption } = req.body || {};
    if (!instanceId || !username || (!image_url && !video_url)) {
      return fail(res, 400, "instance_id, username e (image_url ou video_url) são obrigatórios");
    }

    const ig = await buildClient(instanceId, username);
    let mediaId;

    if (video_url) {
      const videoRes = await ig.media.uploadVideo({ videoUrl: video_url });
      mediaId = videoRes.id;
    } else {
      const photoRes = await ig.media.uploadPhoto({ photoUrl: image_url });
      mediaId = photoRes.id;
    }

    await ig.story.configure({ mediaId });

    if (caption) {
      await ig.media.configure({ mediaId, caption });
    }

    await persistState(ig, instanceId);
    return res.json(ok({ media_id: mediaId, status: "story_posted" }));
  } catch (err) {
    return fail(res, 502, err?.message || "story upload failed");
  }
});

app.get("/instagram/media", async (req, res) => {
  try {
    const instanceId = req.query.instance_id;
    const username = req.query.username;
    if (!instanceId || !username) {
      return fail(res, 400, "instance_id e username são obrigatórios");
    }

    const ig = await buildClient(String(instanceId), String(username));
    const userId = await ig.user.getIdByUsername(String(username));
    const userFeed = ig.feed.user(userId);
    const items = await userFeed.items();

    const media = items.map((item) => ({
      id: item.id,
      media_type: item.media_type,
      image_versions2: item.image_versions2,
      code: item.code,
      like_count: item.like_count,
      comment_count: item.comment_count,
      caption: item.caption?.text,
    }));

    await persistState(ig, String(instanceId));
    return res.json(ok({ users: [{ pk: userId, username, media }] }));
  } catch (err) {
    return fail(res, 502, err?.message || "get media failed");
  }
});

app.post("/instagram/like", async (req, res) => {
  try {
    const { instance_id: instanceId, username, media_id } = req.body || {};
    if (!instanceId || !username || !media_id) {
      return fail(res, 400, "instance_id, username e media_id são obrigatórios");
    }

    const ig = await buildClient(instanceId, username);
    await ig.media.like({ mediaId: media_id });
    await persistState(ig, instanceId);

    return res.json(ok({ status: "ok" }));
  } catch (err) {
    return fail(res, 502, err?.message || "like failed");
  }
});

app.listen(port, () => {
  console.log(`Instagram bridge listening on http://localhost:${port}`);
});
