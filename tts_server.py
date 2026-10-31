import asyncio
import re
import time
import aiohttp
import edge_tts
from edge_tts.communicate import (
    DRM,
    SEC_MS_GEC_VERSION,
    WSS_HEADERS,
    WSS_URL,
    _SSL_CTX,
    TTSConfig,
    connect_id,
    date_to_string,
    get_headers_and_data,
    mkssml,
    ssml_headers_plus_data,
)
import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse

VOICE_PRESETS = {
    # 🤖 1. VOZES DE ROBÔ MASCULINO (DSP SCI-FI PROFISSIONAL)
    "cyborg_optimus": {
        "label": "01. Cyborg Alpha (Optimus / Mecha Bass)",
        "voice": "pt-BR-AntonioNeural",
        "rate": "+4%",
        "pitch": "-14Hz",
        "af": "bass=g=6:f=110,flanger=delay=5:depth=1.2:regen=50:speed=0.5,aecho=0.85:0.7:10:0.3",
    },
    "soundwave": {
        "label": "02. Soundwave (Modulação Robótica Clássica)",
        "voice": "pt-BR-AntonioNeural",
        "rate": "+8%",
        "pitch": "-8Hz",
        "af": "tremolo=f=36:d=0.6,flanger=delay=3:depth=1:regen=40:speed=0.8",
    },
    "androide_cyber": {
        "label": "03. Androide Tático (Cyberpunk / Delamain)",
        "voice": "en-US-BrianMultilingualNeural",
        "rate": "+6%",
        "pitch": "-10Hz",
        "af": "flanger=delay=7:depth=2:regen=60:width=90:speed=0.35,equalizer=f=3000:t=q:w=1.2:g=2.5",
    },
    "hal9000": {
        "label": "04. HAL 9000 (IA Sintética Metódica)",
        "voice": "en-US-BrianMultilingualNeural",
        "rate": "-2%",
        "pitch": "-18Hz",
        "af": "aecho=0.8:0.6:18|36:0.28|0.18,bass=g=5:f=100",
    },
    "protocol_droid": {
        "label": "05. Droide de Protocolo (Sci-Fi Articulado)",
        "voice": "pt-BR-AntonioNeural",
        "rate": "+12%",
        "pitch": "+4Hz",
        "af": "flanger=delay=4:depth=1.5:regen=65:speed=1.2,highpass=f=160,lowpass=f=6800",
    },
    "geth_legion": {
        "label": "06. Legion / Geth (Rede Sintética)",
        "voice": "en-US-BrianMultilingualNeural",
        "rate": "+7%",
        "pitch": "-12Hz",
        "af": "flanger=delay=5.5:depth=2.5:regen=65:speed=1.4,vibrato=f=7:d=0.25",
    },
    "titan_dreadnought": {
        "label": "07. Titã Dreadnought (Máquina Pesada)",
        "voice": "pt-BR-AntonioNeural",
        "rate": "+0%",
        "pitch": "-24Hz",
        "af": "asetrate=24000*0.93,aresample=24000,bass=g=7:f=95,aecho=0.8:0.65:14:0.35",
    },
    "jarvis_cyber": {
        "label": "08. Jarvis Cyber (Sintético Limpo & Polido)",
        "voice": "en-US-BrianMultilingualNeural",
        "rate": "+5%",
        "pitch": "-8Hz",
        "af": "flanger=delay=3:depth=1:regen=45:speed=0.4",
    },
    # 🌟 2. Naturais Humanas (Estudos e Mentoria)
    "thalita": {
        "label": "Thalita HD (Ultra Natural & Expressiva)",
        "voice": "pt-BR-ThalitaMultilingualNeural",
        "rate": "+0%",
        "pitch": "+0Hz",
    },
    "francisca": {
        "label": "Francisca (Calma & Acolhedora)",
        "voice": "pt-BR-FranciscaNeural",
        "rate": "+0%",
        "pitch": "+0Hz",
    },
    "antonio": {
        "label": "Antonio (Mentor Profissional)",
        "voice": "pt-BR-AntonioNeural",
        "rate": "+0%",
        "pitch": "+0Hz",
    },
    "brian": {
        "label": "Brian (Jarvis Executivo Sofisticado)",
        "voice": "en-US-BrianMultilingualNeural",
        "rate": "+0%",
        "pitch": "+0Hz",
    },
    "emma": {
        "label": "Emma (Assistente Jovem Internacional)",
        "voice": "en-US-EmmaMultilingualNeural",
        "rate": "+0%",
        "pitch": "+0Hz",
    },
    "ava": {
        "label": "Ava (IA Analítica & Lógica)",
        "voice": "en-US-AvaMultilingualNeural",
        "rate": "+0%",
        "pitch": "+0Hz",
    },
    "andrew": {
        "label": "Andrew (Copiloto Jovem Descontraído)",
        "voice": "en-US-AndrewMultilingualNeural",
        "rate": "+0%",
        "pitch": "+0Hz",
    },
    # ✨ 3. Estilo Pet / Companheiro
    "stackchan": {
        "label": "Stack-chan Fofa Clássica",
        "voice": "pt-BR-FranciscaNeural",
        "rate": "+24%",
        "pitch": "+36Hz",
    },
    "chibi_gamer": {
        "label": "Chibi Gamer (Expressiva)",
        "voice": "pt-BR-ThalitaMultilingualNeural",
        "rate": "+18%",
        "pitch": "+24Hz",
    },
    "copiloto_agil": {
        "label": "Copiloto Tech Ágil",
        "voice": "en-US-AndrewMultilingualNeural",
        "rate": "+14%",
        "pitch": "+8Hz",
    },
    "robozinho": {
        "label": "Robozinho Companheiro",
        "voice": "pt-BR-AntonioNeural",
        "rate": "+20%",
        "pitch": "+22Hz",
    },
    # Aliases retrocompatíveis
    "jarvis": {
        "label": "Jarvis Cyber",
        "voice": "en-US-BrianMultilingualNeural",
        "rate": "+5%",
        "pitch": "-8Hz",
        "af": "flanger=delay=3:depth=1:regen=45:speed=0.4",
    },
    "cyber_bot": {
        "label": "Cyborg Alpha",
        "voice": "pt-BR-AntonioNeural",
        "rate": "+4%",
        "pitch": "-14Hz",
        "af": "bass=g=6:f=110,flanger=delay=5:depth=1.2:regen=50:speed=0.5,aecho=0.85:0.7:10:0.3",
    },
    "mecha_chan": {
        "label": "Soundwave",
        "voice": "pt-BR-AntonioNeural",
        "rate": "+8%",
        "pitch": "-8Hz",
        "af": "tremolo=f=36:d=0.6,flanger=delay=3:depth=1:regen=40:speed=0.8",
    },
    "retro_robot": {
        "label": "HAL 9000",
        "voice": "en-US-BrianMultilingualNeural",
        "rate": "-2%",
        "pitch": "-18Hz",
        "af": "aecho=0.8:0.6:18|36:0.28|0.18,bass=g=5:f=100",
    },
}

EMOJI_PATTERN = re.compile(
    "["
    "\U0001F600-\U0001F64F"
    "\U0001F300-\U0001F5FF"
    "\U0001F680-\U0001F6FF"
    "\U0001F700-\U0001F77F"
    "\U0001F780-\U0001F7FF"
    "\U0001F800-\U0001F8FF"
    "\U0001F900-\U0001F9FF"
    "\U0001FA00-\U0001FA6F"
    "\U0001FA70-\U0001FAFF"
    "\U00002702-\U000027B0"
    "\U000024C2-\U0001F251"
    "]+",
    flags=re.UNICODE,
)


def clean_text_for_speech(text: str) -> str:
    cleaned = EMOJI_PATTERN.sub(" ", text)
    cleaned = re.sub(r"[*_`#~<>]", "", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if not re.search(r"[A-Za-zÀ-ÿ0-9]", cleaned):
        return ""
    return cleaned


class WarmWSManager:
    """Mantém um WebSocket TLS pré-aquecido com a Microsoft para latência ~200ms."""

    def __init__(self):
        self.session: aiohttp.ClientSession | None = None
        self.warm_ws: aiohttp.ClientWebSocketResponse | None = None
        self.warm_created_at: float = 0.0
        self.lock = asyncio.Lock()
        self.keepalive_task: asyncio.Task | None = None

    async def start(self):
        connector = aiohttp.TCPConnector(limit=8, ttl_dns_cache=300, ssl=_SSL_CTX)
        timeout = aiohttp.ClientTimeout(total=12.0, connect=4.0, sock_read=6.0)
        self.session = aiohttp.ClientSession(connector=connector, timeout=timeout, trust_env=True)
        await self.ensure_warm()
        self.keepalive_task = asyncio.create_task(self._maintainer_loop())

    async def stop(self):
        if self.keepalive_task:
            self.keepalive_task.cancel()
        if self.warm_ws and not self.warm_ws.closed:
            await self.warm_ws.close()
        if self.session and not self.session.closed:
            await self.session.close()

    async def _open_configured_ws(self) -> aiohttp.ClientWebSocketResponse:
        assert self.session is not None
        url = (
            f"{WSS_URL}&ConnectionId={connect_id()}"
            f"&Sec-MS-GEC={DRM.generate_sec_ms_gec()}"
            f"&Sec-MS-GEC-Version={SEC_MS_GEC_VERSION}"
        )
        async with asyncio.timeout(4.5):
            ws = await self.session.ws_connect(
                url,
                compress=15,
                headers=DRM.headers_with_muid(WSS_HEADERS),
                ssl=_SSL_CTX,
                heartbeat=15.0,
            )
            await ws.send_str(
                f"X-Timestamp:{date_to_string()}\r\n"
                "Content-Type:application/json; charset=utf-8\r\n"
                "Path:speech.config\r\n\r\n"
                '{"context":{"synthesis":{"audio":{"metadataoptions":{'
                '"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"'
                '},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n'
            )
            return ws

    async def ensure_warm(self):
        async with self.lock:
            now = time.monotonic()
            if (
                self.warm_ws is not None
                and not self.warm_ws.closed
                and (now - self.warm_created_at) < 20.0
            ):
                return
            old_ws = self.warm_ws
            self.warm_ws = None
            if old_ws and not old_ws.closed:
                asyncio.create_task(old_ws.close())
            try:
                self.warm_ws = await self._open_configured_ws()
                self.warm_created_at = time.monotonic()
            except Exception:
                self.warm_ws = None

    async def acquire_ws(self) -> aiohttp.ClientWebSocketResponse | None:
        ws = None
        async with self.lock:
            now = time.monotonic()
            if (
                self.warm_ws is not None
                and not self.warm_ws.closed
                and (now - self.warm_created_at) < 22.0
            ):
                ws = self.warm_ws
                self.warm_ws = None
            elif self.warm_ws is not None:
                old = self.warm_ws
                self.warm_ws = None
                asyncio.create_task(old.close())
        asyncio.create_task(self.ensure_warm())
        return ws

    async def release_reusable_ws(self, ws: aiohttp.ClientWebSocketResponse):
        if ws.closed:
            return
        async with self.lock:
            if self.warm_ws is None:
                self.warm_ws = ws
                self.warm_created_at = time.monotonic()
                return
        await ws.close()

    async def _maintainer_loop(self):
        while True:
            await asyncio.sleep(8.0)
            try:
                await self.ensure_warm()
            except Exception:
                pass


ws_manager = WarmWSManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await ws_manager.start()
    yield
    await ws_manager.stop()


app = FastAPI(title="Stack-chan Ultra-Fast Neural TTS Server", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "warm": ws_manager.warm_ws is not None and not ws_manager.warm_ws.closed,
        "presets": {k: v["label"] for k, v in VOICE_PRESETS.items()},
    }


async def stream_from_ws(ws: aiohttp.ClientWebSocketResponse, ssml_payload: str):
    await ws.send_str(ssml_payload)
    got_audio = False
    try:
        while True:
            async with asyncio.timeout(5.0):
                received = await ws.receive()
            if received.type == aiohttp.WSMsgType.TEXT:
                if "Path:turn.end" in received.data:
                    break
            elif received.type == aiohttp.WSMsgType.BINARY:
                if len(received.data) > 2:
                    header_len = int.from_bytes(received.data[:2], "big")
                    params, audio_bytes = get_headers_and_data(received.data, header_len)
                    if params.get(b"Path") == b"audio" and audio_bytes:
                        got_audio = True
                        yield audio_bytes
            elif received.type in (aiohttp.WSMsgType.ERROR, aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.CLOSING):
                break
        if got_audio and not ws.closed:
            await ws_manager.release_reusable_ws(ws)
        elif not ws.closed:
            await ws.close()
    except Exception:
        if not ws.closed:
            await ws.close()
        raise


@app.get("/tts")
async def synthesize(
    text: str = Query(..., min_length=1),
    preset: str = Query("stackchan"),
):
    speech_text = clean_text_for_speech(text)
    if not speech_text:
        return Response(status_code=204)

    cfg = VOICE_PRESETS.get(preset, VOICE_PRESETS["stackchan"])
    filter_str = cfg.get("af")

    # Se houver filtro de robô configurado (DSP FFmpeg), processa e retorna áudio completo
    if filter_str:
        raw_chunks = bytearray()
        communicate = edge_tts.Communicate(
            text=speech_text,
            voice=cfg["voice"],
            rate=cfg["rate"],
            pitch=cfg["pitch"],
        )
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                raw_chunks.extend(chunk["data"])

        if not raw_chunks:
            return Response(status_code=204)

        try:
            proc = await asyncio.create_subprocess_exec(
                "ffmpeg", "-i", "pipe:0", "-af", filter_str, "-f", "mp3", "pipe:1",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL
            )
            filtered_audio, _ = await proc.communicate(input=bytes(raw_chunks))
            if filtered_audio:
                return Response(
                    content=filtered_audio,
                    media_type="audio/mpeg",
                    headers={"Content-Length": str(len(filtered_audio)), "Cache-Control": "no-store"},
                )
        except Exception:
            pass

        return Response(
            content=bytes(raw_chunks),
            media_type="audio/mpeg",
            headers={"Content-Length": str(len(raw_chunks)), "Cache-Control": "no-store"},
        )

    # Caminho ultra-rápido para vozes sem filtro (streaming direto WebSocket)
    tts_cfg = TTSConfig(cfg["voice"], cfg["rate"], "+0%", cfg["pitch"], "SentenceBoundary")
    ssml_frame = ssml_headers_plus_data(
        connect_id(),
        date_to_string(),
        mkssml(tts_cfg, speech_text.encode("utf-8")),
    )

    async def audio_generator():
        ws = await ws_manager.acquire_ws()
        if ws is not None:
            try:
                yielded = False
                async for chunk in stream_from_ws(ws, ssml_frame):
                    yielded = True
                    yield chunk
                if yielded:
                    return
            except Exception:
                pass

        communicate = edge_tts.Communicate(
            text=speech_text,
            voice=cfg["voice"],
            rate=cfg["rate"],
            pitch=cfg["pitch"],
        )
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                yield chunk["data"]

    return StreamingResponse(
        audio_generator(),
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-store"},
    )


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8086, log_level="warning")
