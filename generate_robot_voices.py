import os
import asyncio
import subprocess
import edge_tts

out_dir = r"C:\Stack-Chan\desktop-pet\amostras_robos_masculinos"
os.makedirs(out_dir, exist_ok=True)

test_phrase = "Olá! Eu sou a Stack-chan, sua inteligência artificial robótica. Sistemas de engenharia de software calibrados e prontos."

robot_configs = [
    {
        "id": "01_Cyborg_Optimus",
        "file": "01_Cyborg_Optimus.mp3",
        "voice": "pt-BR-AntonioNeural",
        "rate": "+4%",
        "pitch": "-14Hz",
        "af": "bass=g=6:f=110,flanger=delay=5:depth=1.2:regen=50:speed=0.5,aecho=0.85:0.7:10:0.3",
        "name": "Cyborg Alpha (Optimus / Mecha Bass)",
        "desc": "Voz masculina grave e encorpada com ressonância metálica de chassi cibernético."
    },
    {
        "id": "02_Soundwave_Transformers",
        "file": "02_Soundwave_Transformers.mp3",
        "voice": "pt-BR-AntonioNeural",
        "rate": "+8%",
        "pitch": "-8Hz",
        "af": "tremolo=f=36:d=0.6,flanger=delay=3:depth=1:regen=40:speed=0.8",
        "name": "Soundwave (Modulação Robótica Clássica)",
        "desc": "Efeito clássico de modulação em anel dos robôs dos anos 80/90, cadenciado e vibrante."
    },
    {
        "id": "03_Androide_Cyberpunk",
        "file": "03_Androide_Cyberpunk.mp3",
        "voice": "en-US-BrianMultilingualNeural",
        "rate": "+6%",
        "pitch": "-10Hz",
        "af": "flanger=delay=7:depth=2:regen=60:width=90:speed=0.35,equalizer=f=3000:t=q:w=1.2:g=2.5",
        "name": "Androide Tático (Cyberpunk / Delamain)",
        "desc": "Robô futurista elegante com phasing metálico cristalino e dicção perfeita."
    },
    {
        "id": "04_HAL_9000_IA",
        "file": "04_HAL_9000_IA.mp3",
        "voice": "en-US-BrianMultilingualNeural",
        "rate": "-2%",
        "pitch": "-18Hz",
        "af": "aecho=0.8:0.6:18|36:0.28|0.18,bass=g=5:f=100",
        "name": "HAL 9000 (IA Sintética Metódica)",
        "desc": "Tom calmo, profundo, sem inflexão emocional, estilo computador de bordo clássico."
    },
    {
        "id": "05_Protocol_Droid",
        "file": "05_Protocol_Droid.mp3",
        "voice": "pt-BR-AntonioNeural",
        "rate": "+12%",
        "pitch": "+4Hz",
        "af": "flanger=delay=4:depth=1.5:regen=65:speed=1.2,highpass=f=160,lowpass=f=6800",
        "name": "Droide de Protocolo (Sci-Fi Articulado)",
        "desc": "Robô ágil com timbre metálico nítido e entonação analítica rápida."
    },
    {
        "id": "06_Geth_Legion",
        "file": "06_Geth_Legion.mp3",
        "voice": "en-US-BrianMultilingualNeural",
        "rate": "+7%",
        "pitch": "-12Hz",
        "af": "flanger=delay=5.5:depth=2.5:regen=65:speed=1.4,vibrato=f=7:d=0.25",
        "name": "Legion / Geth (Rede Sintética)",
        "desc": "Efeito de múltiplos núcleos de IA processando a voz em ressonância simultânea."
    },
    {
        "id": "07_Titan_Dreadnought",
        "file": "07_Titan_Dreadnought.mp3",
        "voice": "pt-BR-AntonioNeural",
        "rate": "+0%",
        "pitch": "-24Hz",
        "af": "asetrate=24000*0.93,aresample=24000,bass=g=7:f=95,aecho=0.8:0.65:14:0.35",
        "name": "Titã Dreadnought (Máquina Pesada)",
        "desc": "Voz mecânica extremamente grave e imponente de robô industrial gigante."
    },
    {
        "id": "08_Jarvis_Cyber",
        "file": "08_Jarvis_Cyber.mp3",
        "voice": "en-US-BrianMultilingualNeural",
        "rate": "+5%",
        "pitch": "-8Hz",
        "af": "flanger=delay=3:depth=1:regen=45:speed=0.4",
        "name": "Jarvis Cyber (Sintético Limpo & Polido)",
        "desc": "Assistente masculino futurista com leve toque mecânico de sintetizador digital."
    }
]

async def generate_all():
    print(f"Gerando {len(robot_configs)} amostras de robôs masculinos...")
    for r in robot_configs:
        raw_path = os.path.join(out_dir, "raw_" + r["file"])
        final_path = os.path.join(out_dir, r["file"])
        try:
            c = edge_tts.Communicate(test_phrase, r["voice"], rate=r["rate"], pitch=r["pitch"])
            await c.save(raw_path)
            cmd = ["ffmpeg", "-y", "-i", raw_path, "-af", r["af"], final_path]
            subprocess.run(cmd, capture_output=True, check=True)
            if os.path.exists(raw_path):
                os.remove(raw_path)
            print(f"OK -> {r['name']} ({r['file']})")
        except Exception as e:
            print(f"FALHA em {r['name']}: {e}")
    print("Processamento concluído com sucesso!")

if __name__ == "__main__":
    asyncio.run(generate_all())
