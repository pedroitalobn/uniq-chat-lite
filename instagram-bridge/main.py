from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
import os, json, logging, tempfile
from pathlib import Path

import httpx
from instagrapi import Client
from instagrapi.exceptions import (
    BadPassword, ChallengeRequired, FeedbackRequired,
    PleaseWaitFewMinutes, UserNotFound, LoginRequired,
    ClientLoginRequired, MediaNotFound, ReloginAttemptExceeded,
    SelectContactPointRecoveryForm, RecaptchaChallengeForm,
    TwoFactorRequired, UnknownError,
)

app = FastAPI(title="Instagram Bridge", version="2.0.0")

SESSIONS_DIR = os.environ.get("INSTAGRAM_BRIDGE_SESSIONS_DIR", "./sessions")
os.makedirs(SESSIONS_DIR, exist_ok=True)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ── File helpers ──────────────────────────────────────────────────────────────

def session_file(iid: str) -> str:
    return os.path.join(SESSIONS_DIR, f"{iid}.json")

def meta_file(iid: str) -> str:
    return os.path.join(SESSIONS_DIR, f"{iid}.meta.json")

def load_session(iid: str) -> dict:
    p = session_file(iid)
    if os.path.exists(p):
        try:
            with open(p) as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_session(cl: Client, iid: str):
    with open(session_file(iid), "w") as f:
        json.dump(cl.get_settings(), f)

def load_meta(iid: str) -> dict:
    p = meta_file(iid)
    if os.path.exists(p):
        try:
            with open(p) as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_meta(iid: str, data: dict):
    with open(meta_file(iid), "w") as f:
        json.dump(data, f)


# ── Client ────────────────────────────────────────────────────────────────────

def build_client(iid: str) -> Client:
    cl = Client()
    meta = load_meta(iid)
    if meta.get("proxy"):
        cl.set_proxy(meta["proxy"])
    settings = load_session(iid)
    if settings:
        try:
            cl.set_settings(settings)
        except Exception:
            pass
    return cl


# ── Responses ─────────────────────────────────────────────────────────────────

def ok(data):
    return {"success": True, "data": data}

def fail(status: int, msg: str):
    return JSONResponse(status_code=status, content={"success": False, "error": msg})


# ── Error mapping ─────────────────────────────────────────────────────────────

def map_error(err: Exception) -> tuple[int, str]:
    if isinstance(err, BadPassword):
        return 422, "Senha incorreta. Verifique e tente novamente."
    if isinstance(err, UserNotFound):
        return 422, "Usuário não encontrado no Instagram."
    if isinstance(err, PleaseWaitFewMinutes):
        return 422, "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente."
    if isinstance(err, FeedbackRequired):
        return 422, "Instagram bloqueou esta ação temporariamente. Tente novamente mais tarde ou use um proxy diferente."
    if isinstance(err, TwoFactorRequired):
        return 422, "Autenticação de dois fatores ativada. Use o código do app autenticador."
    if isinstance(err, (LoginRequired, ClientLoginRequired)):
        return 401, "Sessão expirada. Faça login novamente."
    if isinstance(err, MediaNotFound):
        return 422, "Mídia não encontrada."
    if isinstance(err, ReloginAttemptExceeded):
        return 422, "Limite de tentativas de login excedido. Tente novamente em alguns minutos."
    if isinstance(err, UnknownError):
        # UnknownError carrega mensagens legíveis do Instagram (conta não encontrada, etc.)
        return 422, str(err)
    msg = str(err)
    ml = msg.lower()
    if "disabled" in ml or "banned" in ml or "suspended" in ml:
        return 422, "Conta desativada ou banida pelo Instagram."
    if "consent_required" in ml:
        return 422, "Instagram requer aceite de novos termos. Acesse o app e aceite os termos."
    if ("invalid" in ml and "code" in ml) or "wrong code" in ml:
        return 422, "Código de verificação inválido. Verifique e tente novamente."
    if "eof" in ml or "eof when reading" in ml or "connection reset" in ml or "remotedisconnected" in ml:
        return 422, f"Instagram encerrou a conexão inesperadamente ({msg}). Possíveis causas: IP bloqueado pelo Instagram, proxy com credenciais inválidas ou proxy sem suporte a HTTPS — verifique o proxy do servidor."
    if "proxy" in ml or "proxyerror" in ml or "tunnel" in ml or "407" in ml:
        return 503, f"Falha na conexão com o proxy ({msg}). Verifique usuário/senha e se o proxy suporta HTTPS."
    if "timeout" in ml or "timed out" in ml or "read timeout" in ml:
        return 503, "Timeout ao conectar com o Instagram. Verifique a conexão do servidor/proxy."
    if "ssl" in ml or "certificate" in ml:
        return 503, "Erro SSL ao conectar com o Instagram. Verifique as configurações do proxy."
    return 502, msg or "Erro desconhecido ao conectar com o Instagram."


# ── URL downloader ────────────────────────────────────────────────────────────

def download_tmp(url: str, suffix: str) -> Path:
    with httpx.Client(timeout=60, follow_redirects=True) as client:
        r = client.get(url)
        r.raise_for_status()
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    tmp.write(r.content)
    tmp.close()
    return Path(tmp.name)


# ── Models ────────────────────────────────────────────────────────────────────

class LoginReq(BaseModel):
    instance_id: str
    username: str
    password: str
    proxy: Optional[str] = None

class ChallengeReq(BaseModel):
    instance_id: str
    username: str
    api_path: str
    code: str
    method: Optional[str] = None

class ChallengeResendReq(BaseModel):
    instance_id: str
    username: str
    api_path: str
    method: Optional[str] = None

class LogoutReq(BaseModel):
    instance_id: str

class DMSendReq(BaseModel):
    instance_id: str
    username: str
    recipient: str
    message: str

class DMReplyReq(BaseModel):
    instance_id: str
    thread_id: str
    text: str

class FollowReq(BaseModel):
    instance_id: str
    username: str
    target: str

class PostReq(BaseModel):
    instance_id: str
    username: str
    image_url: Optional[str] = None
    video_url: Optional[str] = None
    caption: Optional[str] = ""

class StoryReq(BaseModel):
    instance_id: str
    username: str
    image_url: Optional[str] = None
    video_url: Optional[str] = None
    caption: Optional[str] = ""

class LikeReq(BaseModel):
    instance_id: str
    username: str
    media_id: str

class CommentReq(BaseModel):
    instance_id: str
    username: str
    media_id: str
    text: str


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return ok({"service": "instagram-bridge", "version": "2.0.0", "engine": "instagrapi"})


# ── Login ─────────────────────────────────────────────────────────────────────

@app.post("/instagram/login")
def instagram_login(req: LoginReq):
    if req.proxy:
        meta = load_meta(req.instance_id)
        meta["proxy"] = req.proxy
        save_meta(req.instance_id, meta)

    # Try existing session first (avoids unnecessary login requests to Instagram)
    settings = load_session(req.instance_id)
    if settings:
        try:
            cl = build_client(req.instance_id)
            me = cl.user_info(cl.user_id)
            return ok({
                "username": me.username,
                "pk": str(me.pk),
                "profile_pic_url": str(me.profile_pic_url) if me.profile_pic_url else "",
                "full_name": me.full_name,
                "status": "connected",
            })
        except Exception:
            pass

    # Fresh login
    cl = Client()
    meta = load_meta(req.instance_id)
    if meta.get("proxy"):
        cl.set_proxy(meta["proxy"])

    # Override the default stdin-blocking challenge handler so that when
    # instagrapi internally calls challenge_resolve(), it raises ChallengeRequired
    # instead of blocking on input() — which would EOF in a container.
    def _raise_challenge(username: str, choice) -> str:
        raise ChallengeRequired()
    cl.challenge_code_handler = _raise_challenge

    try:
        cl.login(req.username, req.password)
        save_session(cl, req.instance_id)
        me = cl.user_info(cl.user_id)
        return ok({
            "username": me.username,
            "pk": str(me.pk),
            "profile_pic_url": str(me.profile_pic_url) if me.profile_pic_url else "",
            "full_name": me.full_name,
            "status": "connected",
        })

    except ChallengeRequired:
        save_session(cl, req.instance_id)
        api_path = cl.last_json.get("challenge", {}).get("api_path", "")

        meta = load_meta(req.instance_id)
        meta["challenge_api_path"] = api_path
        save_meta(req.instance_id, meta)

        # Try to get step info (email mask / phone mask)
        challenge_type = "code"
        options = ["email", "phone"]
        phone_mask = ""
        email_mask = ""
        try:
            step = cl._send_private_request(api_path.lstrip("/"), login=True)
            step_data = step.get("step_data", {})
            email_mask = step_data.get("email", "")
            phone_mask = step_data.get("phone_number", "")
            options = []
            if email_mask:
                options.append("email")
                challenge_type = "email"
            if phone_mask:
                options.append("phone")
                challenge_type = "phone" if not email_mask else "code"
            if not options:
                options = ["email", "phone"]
        except Exception as e:
            logger.warning(f"Could not get challenge step info: {e}")

        return ok({
            "status": "challenge_required",
            "challenge_type": challenge_type,
            "options": options,
            "api_path": api_path,
            "phone_mask": phone_mask,
            "email_mask": email_mask,
        })

    except SelectContactPointRecoveryForm:
        return ok({
            "status": "challenge_required",
            "challenge_type": "email_recovery",
            "options": [],
            "api_path": "",
            "message": "Instagram exige verificação no app ou e-mail antes de concluir o login pela API.",
        })

    except RecaptchaChallengeForm:
        return ok({
            "status": "challenge_required",
            "challenge_type": "recaptcha",
            "options": [],
            "api_path": "",
            "message": "Instagram exige CAPTCHA. Acesse o app do Instagram para desbloquear a conta.",
        })

    except TwoFactorRequired:
        return ok({
            "status": "challenge_required",
            "challenge_type": "2fa",
            "options": ["totp"],
            "api_path": "",
            "message": "Autenticação de dois fatores ativada. Digite o código do app autenticador.",
        })

    except Exception as err:
        status, msg = map_error(err)
        logger.error(f"Instagram login error [{req.username}] proxy={req.proxy!r}: {type(err).__name__}: {err}")
        return fail(status, msg)


# ── Challenge ─────────────────────────────────────────────────────────────────

@app.post("/instagram/challenge")
def instagram_challenge(req: ChallengeReq):
    cl = build_client(req.instance_id)
    meta = load_meta(req.instance_id)
    api_path = req.api_path or meta.get("challenge_api_path", "")
    if not api_path:
        return fail(400, "challenge expirado, faça login novamente")
    try:
        cl.challenge_url = api_path
        cl.challenge_verify_code(req.code)
        save_session(cl, req.instance_id)
        me = cl.user_info(cl.user_id)
        return ok({
            "username": me.username,
            "pk": str(me.pk),
            "profile_pic_url": str(me.profile_pic_url) if me.profile_pic_url else "",
            "status": "connected",
        })
    except Exception as err:
        status, msg = map_error(err)
        return fail(status, msg)


@app.post("/instagram/challenge/resend")
def instagram_challenge_resend(req: ChallengeResendReq):
    cl = build_client(req.instance_id)
    meta = load_meta(req.instance_id)
    api_path = req.api_path or meta.get("challenge_api_path", "")
    if not api_path:
        return fail(400, "challenge expirado, faça login novamente")
    try:
        cl.challenge_url = api_path
        choice = 0 if req.method == "phone" else 1  # 1=email (default), 0=phone
        cl.challenge_send_code(choice)
        return ok({"message": "código reenviado"})
    except Exception as err:
        status, msg = map_error(err)
        return fail(status, msg)


# ── Logout ────────────────────────────────────────────────────────────────────

@app.post("/instagram/logout")
def instagram_logout(req: LogoutReq):
    try:
        cl = build_client(req.instance_id)
        cl.logout()
    except Exception:
        pass
    for f in [session_file(req.instance_id), meta_file(req.instance_id)]:
        if os.path.exists(f):
            os.remove(f)
    return ok({"status": "disconnected"})


# ── Direct Messages ───────────────────────────────────────────────────────────

@app.post("/instagram/dm/send")
def instagram_dm_send(req: DMSendReq):
    cl = build_client(req.instance_id)
    try:
        uid = cl.user_id_from_username(req.recipient)
        thread = cl.direct_send(req.message, user_ids=[uid])
        save_session(cl, req.instance_id)
        return ok({"thread_id": str(thread.id), "status": "sent"})
    except Exception as err:
        status, msg = map_error(err)
        return fail(status, msg)


@app.post("/instagram/dm/reply")
def instagram_dm_reply(req: DMReplyReq):
    cl = build_client(req.instance_id)
    try:
        cl.direct_answer(int(req.thread_id), req.text)
        save_session(cl, req.instance_id)
        return ok({"status": "sent", "thread_id": req.thread_id})
    except Exception as err:
        status, msg = map_error(err)
        return fail(status, msg)


@app.get("/instagram/dm/read")
def instagram_dm_inbox(instance_id: str, username: str):
    cl = build_client(instance_id)
    try:
        raw = cl.direct_threads(amount=20)
        threads = [{
            "thread_id": str(t.id),
            "users": [{"pk": str(u.pk), "username": u.username, "full_name": u.full_name} for u in t.users],
            "messages": [{
                "item_id": str(m.id),
                "user_id": str(m.user_id),
                "text": m.text or "",
                "timestamp": m.timestamp.isoformat() if m.timestamp else "",
                "item_type": m.item_type,
            } for m in (t.messages or [])[:10]],
            "unread_count": t.read_state or 0,
        } for t in raw]
        save_session(cl, instance_id)
        return ok({"threads": threads})
    except Exception as err:
        status, msg = map_error(err)
        return fail(status, msg)


@app.get("/instagram/dm/thread")
def instagram_dm_thread(instance_id: str, thread_id: str):
    cl = build_client(instance_id)
    try:
        thread = cl.direct_thread(int(thread_id), amount=50)
        messages = [{
            "item_id": str(m.id),
            "user_id": str(m.user_id),
            "text": m.text or "",
            "timestamp": m.timestamp.isoformat() if m.timestamp else "",
            "item_type": m.item_type,
        } for m in (thread.messages or [])]
        save_session(cl, instance_id)
        return ok({"thread_id": thread_id, "messages": messages})
    except Exception as err:
        status, msg = map_error(err)
        return fail(status, msg)


# ── Profile ───────────────────────────────────────────────────────────────────

@app.get("/instagram/profile")
def instagram_profile(instance_id: str, username: str, target: str):
    cl = build_client(instance_id)
    try:
        u = cl.user_info_by_username(target)
        save_session(cl, instance_id)
        return ok({
            "pk": str(u.pk),
            "username": u.username,
            "full_name": u.full_name,
            "biography": u.biography,
            "profile_pic_url": str(u.profile_pic_url) if u.profile_pic_url else "",
            "is_private": u.is_private,
            "is_verified": u.is_verified,
            "follower_count": u.follower_count,
            "following_count": u.following_count,
            "media_count": u.media_count,
            "external_url": str(u.external_url) if u.external_url else "",
        })
    except Exception as err:
        status, msg = map_error(err)
        return fail(status, msg)


# ── Follow / Unfollow ─────────────────────────────────────────────────────────

@app.post("/instagram/follow")
def instagram_follow(req: FollowReq):
    cl = build_client(req.instance_id)
    try:
        uid = cl.user_id_from_username(req.target)
        cl.user_follow(uid)
        save_session(cl, req.instance_id)
        return ok({"status": "ok", "target": req.target})
    except Exception as err:
        status, msg = map_error(err)
        return fail(status, msg)


@app.post("/instagram/unfollow")
def instagram_unfollow(req: FollowReq):
    cl = build_client(req.instance_id)
    try:
        uid = cl.user_id_from_username(req.target)
        cl.user_unfollow(uid)
        save_session(cl, req.instance_id)
        return ok({"status": "ok", "target": req.target})
    except Exception as err:
        status, msg = map_error(err)
        return fail(status, msg)


# ── Media (post/story) ────────────────────────────────────────────────────────

@app.post("/instagram/post")
def instagram_post(req: PostReq):
    cl = build_client(req.instance_id)
    tmp: Optional[Path] = None
    try:
        if req.video_url:
            tmp = download_tmp(req.video_url, ".mp4")
            media = cl.video_upload(tmp, caption=req.caption or "")
        elif req.image_url:
            tmp = download_tmp(req.image_url, ".jpg")
            media = cl.photo_upload(tmp, caption=req.caption or "")
        else:
            return fail(400, "image_url ou video_url é obrigatório")
        save_session(cl, req.instance_id)
        return ok({
            "media_id": str(media.id),
            "media_pk": str(media.pk),
            "code": media.code,
            "status": "posted",
            "url": f"https://instagram.com/p/{media.code}",
        })
    except Exception as err:
        status, msg = map_error(err)
        return fail(status, msg)
    finally:
        if tmp and tmp.exists():
            tmp.unlink()


@app.post("/instagram/story")
def instagram_story(req: StoryReq):
    cl = build_client(req.instance_id)
    tmp: Optional[Path] = None
    try:
        if req.video_url:
            tmp = download_tmp(req.video_url, ".mp4")
        elif req.image_url:
            tmp = download_tmp(req.image_url, ".jpg")
        else:
            return fail(400, "image_url ou video_url é obrigatório")
        media = cl.story_upload(tmp, caption=req.caption or "")
        save_session(cl, req.instance_id)
        return ok({"media_id": str(media.id), "status": "story_posted"})
    except Exception as err:
        status, msg = map_error(err)
        return fail(status, msg)
    finally:
        if tmp and tmp.exists():
            tmp.unlink()


@app.get("/instagram/media")
def instagram_media(instance_id: str, username: str, amount: int = 12):
    cl = build_client(instance_id)
    try:
        uid = cl.user_id_from_username(username)
        medias = cl.user_medias(uid, amount=amount)
        save_session(cl, instance_id)
        return ok({"medias": [{
            "pk": str(m.pk),
            "id": str(m.id),
            "code": m.code,
            "media_type": m.media_type,
            "thumbnail_url": str(m.thumbnail_url) if m.thumbnail_url else "",
            "like_count": m.like_count,
            "comment_count": m.comment_count,
            "caption": m.caption_text or "",
            "taken_at": m.taken_at.isoformat() if m.taken_at else "",
        } for m in medias]})
    except Exception as err:
        status, msg = map_error(err)
        return fail(status, msg)


# ── Like / Unlike ─────────────────────────────────────────────────────────────

@app.post("/instagram/like")
def instagram_like(req: LikeReq):
    cl = build_client(req.instance_id)
    try:
        cl.media_like(req.media_id)
        save_session(cl, req.instance_id)
        return ok({"status": "ok"})
    except Exception as err:
        status, msg = map_error(err)
        return fail(status, msg)


@app.post("/instagram/unlike")
def instagram_unlike(req: LikeReq):
    cl = build_client(req.instance_id)
    try:
        cl.media_unlike(req.media_id)
        save_session(cl, req.instance_id)
        return ok({"status": "ok"})
    except Exception as err:
        status, msg = map_error(err)
        return fail(status, msg)


# ── Comments ──────────────────────────────────────────────────────────────────

@app.post("/instagram/comment")
def instagram_comment(req: CommentReq):
    cl = build_client(req.instance_id)
    try:
        c = cl.media_comment(req.media_id, req.text)
        save_session(cl, req.instance_id)
        return ok({"comment_id": str(c.pk), "text": c.text, "status": "ok"})
    except Exception as err:
        status, msg = map_error(err)
        return fail(status, msg)


@app.get("/instagram/comments")
def instagram_comments(instance_id: str, media_id: str, amount: int = 20):
    cl = build_client(instance_id)
    try:
        comments = cl.media_comments(media_id, amount=amount)
        save_session(cl, instance_id)
        return ok({"comments": [{
            "pk": str(c.pk),
            "user": {"pk": str(c.user.pk), "username": c.user.username},
            "text": c.text,
            "created_at": c.created_at_utc.isoformat() if c.created_at_utc else "",
            "like_count": c.like_count,
        } for c in comments]})
    except Exception as err:
        status, msg = map_error(err)
        return fail(status, msg)


# ── Search ────────────────────────────────────────────────────────────────────

@app.get("/instagram/search/users")
def instagram_search_users(instance_id: str, query: str):
    cl = build_client(instance_id)
    try:
        users = cl.search_users(query)
        save_session(cl, instance_id)
        return ok({"users": [{
            "pk": str(u.pk),
            "username": u.username,
            "full_name": u.full_name,
            "profile_pic_url": str(u.profile_pic_url) if u.profile_pic_url else "",
            "is_private": u.is_private,
            "is_verified": u.is_verified,
        } for u in users[:20]]})
    except Exception as err:
        status, msg = map_error(err)
        return fail(status, msg)


# ── Hashtag ───────────────────────────────────────────────────────────────────

@app.get("/instagram/hashtag")
def instagram_hashtag(instance_id: str, hashtag: str, tab: str = "top", amount: int = 9):
    cl = build_client(instance_id)
    try:
        medias = cl.hashtag_medias_recent(hashtag, amount=amount) if tab == "recent" else cl.hashtag_medias_top(hashtag, amount=amount)
        save_session(cl, instance_id)
        return ok({"hashtag": hashtag, "medias": [{
            "pk": str(m.pk),
            "code": m.code,
            "media_type": m.media_type,
            "thumbnail_url": str(m.thumbnail_url) if m.thumbnail_url else "",
            "like_count": m.like_count,
            "caption": m.caption_text or "",
        } for m in medias]})
    except Exception as err:
        status, msg = map_error(err)
        return fail(status, msg)
