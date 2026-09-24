from flask import Flask, request, jsonify
import requests
import base64
import os
import uuid
import json
import time
import threading
import websocket
import urllib.parse
import tempfile
import math
import subprocess

app = Flask(__name__)

# Estado de jobs en memoria (job_id -> resultado)
jobs = {}

def cleanup_old_images():
    """Elimina imágenes temporales de ejecuciones anteriores (más de 1 hora)."""
    try:
        out_dir = os.path.join(tempfile.gettempdir(), 'zms-flux')
        if not os.path.exists(out_dir):
            return
        now = time.time()
        for fname in os.listdir(out_dir):
            fpath = os.path.join(out_dir, fname)
            if os.path.isfile(fpath) and fname.startswith('flux-') and fname.endswith('.png'):
                age = now - os.path.getmtime(fpath)
                if age > 3600:  # más de 1 hora
                    os.remove(fpath)
                    print(f'[Cleanup] Eliminado: {fpath}')
    except Exception as e:
        print(f'[Cleanup] Error: {e}')

# Limpiar imágenes viejas al arrancar
cleanup_old_images()

# CORS simple sin dependencia externa
@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response

COMFY_UI_URL = "http://127.0.0.1:8188"

def listen_ws_progress(ws_url, job_id, prompt_id, total_nodes=0):
    """Escucha el WebSocket de ComfyUI y actualiza el progreso del job.

    ComfyUI solo emite mensajes 'progress' para nodos que reportan progreso
    (p.ej. samplers/KSampler). Los workflows de mejora (VHS_LoadVideo ->
    UpscaleModelLoader -> ImageUpscaleWithModel -> VHS_VideoCombine) NO tienen
    sampler, asi que nunca llegan 'progress' y el porcentaje se queda en 0.
    Para esos casos estimamos el progreso contando los mensajes 'executing'
    (uno por nodo que empieza a ejecutarse).

    IMPORTANTE: si el workflow SI tiene sampler (LTX i2v/t2v), los mensajes
    'progress' son la fuente de verdad. La estimacion por conteo de nodos
    ('executing'/'execution_cached') SOLO se usa como fallback mientras no
    haya llegado ningun 'progress' real; una vez llega el primero, la
    estimacion deja de sobreescribir el progreso real (si no, compite con el
    sampler y el % da saltos erraticos 80->60->100)."""
    seen = {'count': 0, 'got_real_progress': False}
    def on_message(ws, message):
        try:
            msg = json.loads(message)
            msg_type = msg.get('type', '')
            data = msg.get('data', {})

            if msg_type == 'progress':
                current = data.get('value', 0)
                total = data.get('max', 1)
                seen['got_real_progress'] = True
                if job_id in jobs:
                    jobs[job_id]['progress'] = {'current': current, 'total': total, 'percent': int(current / total * 100)}
                print(f"[Bridge] Job {job_id}: Progreso {current}/{total}")
            elif msg_type == 'execution_start' and data.get('prompt_id') == prompt_id:
                if job_id in jobs:
                    jobs[job_id]['status'] = 'running'
                    if jobs[job_id].get('progress', {}).get('percent', 0) < 2:
                        jobs[job_id]['progress'] = {'current': 0, 'total': max(total_nodes, 1), 'percent': 2}
            elif msg_type == 'executing' and data.get('prompt_id') == prompt_id:
                node = data.get('node')
                if node is None:
                    # Ejecucion terminada en ComfyUI (falta descargar el resultado)
                    if job_id in jobs and jobs[job_id].get('progress', {}).get('percent', 0) < 95:
                        jobs[job_id]['progress'] = {'current': max(total_nodes, 1), 'total': max(total_nodes, 1), 'percent': 95}
                else:
                    seen['count'] += 1
                    if job_id in jobs and not seen['got_real_progress']:
                        # Solo estimar si NO ha llegado progreso real del sampler
                        if total_nodes and total_nodes > 0:
                            pct = int(min(90, seen['count'] / total_nodes * 90))
                        else:
                            pct = max(jobs[job_id].get('progress', {}).get('percent', 0), 5)
                        jobs[job_id]['progress'] = {'current': seen['count'], 'total': max(total_nodes, 1), 'percent': max(pct, 2)}
                        jobs[job_id]['status'] = 'running'
                    print(f"[Bridge] Job {job_id}: Nodo ejecutando {node} ({seen['count']}/{total_nodes or '?'})")
            elif msg_type == 'execution_cached' and data.get('prompt_id') == prompt_id:
                # Nodos cacheados saltan su 'executing'; avanzar progreso igualmente
                cached = data.get('nodes', []) or []
                seen['count'] += len(cached)
                if job_id in jobs and total_nodes and not seen['got_real_progress']:
                    pct = int(min(90, seen['count'] / total_nodes * 90))
                    jobs[job_id]['progress'] = {'current': seen['count'], 'total': total_nodes, 'percent': max(pct, 2)}
            elif msg_type == 'execution_success' and data.get('prompt_id') == prompt_id:
                print(f"[Bridge] Job {job_id}: Ejecución completada en ComfyUI")
            elif msg_type == 'execution_error' and data.get('prompt_id') == prompt_id:
                # Capturar el detalle real del error de ComfyUI (excepcion, nodo, traceback)
                emsg = data.get('exception_message') or data.get('node_message') or 'Error en la ejecución de ComfyUI'
                parts = [f"nodo: {data.get('node_type', '?')} (id {data.get('node_id', '?')})"] if data.get('node_type') or data.get('node_id') else []
                etype = data.get('exception_type')
                if etype: parts.append(f"tipo: {etype}")
                tb = data.get('traceback')
                if tb:
                    parts.append("traceback: " + str(tb).replace('\\n', ' | ')[-600:])
                detail = emsg + (' [' + ', '.join(parts) + ']' if parts else '')
                print(f"[Bridge] Job {job_id}: execution_error: {detail}")
                jobs[job_id] = {"status": "error", "error": detail}
        except Exception as e:
            pass

    def on_error(ws, error):
        print(f"[Bridge] Job {job_id}: WS error: {error}")

    def on_close(ws, close_status_code, close_msg):
        print(f"[Bridge] Job {job_id}: WS cerrado")

    try:
        ws = websocket.WebSocketApp(ws_url, on_message=on_message, on_error=on_error, on_close=on_close)
        ws.run_forever()
    except Exception as e:
        print(f"[Bridge] Job {job_id}: Error conectando WS: {e}")

def run_job(job_id, comfy_url, prompt_text, workflow):
    """Ejecuta el workflow en ComfyUI en segundo plano y guarda el resultado."""
    try:
        # Enviar a ComfyUI
        client_id = str(uuid.uuid4())
        payload = {"prompt": workflow, "client_id": client_id}
        print(f"[Bridge] Job {job_id}: Enviando workflow a {comfy_url}/prompt")
        res = requests.post(f"{comfy_url}/prompt", json=payload)
        if not res.ok:
            error_text = res.text
            print(f"[Bridge] Job {job_id}: Error {res.status_code} de ComfyUI: {error_text}")
            jobs[job_id] = {"status": "error", "error": f"ComfyUI devolvió {res.status_code}: {error_text}"}
            return
        data = res.json()
        prompt_id = data.get("prompt_id")
        print(f"[Bridge] Job {job_id}: prompt_id={prompt_id}")
        if not prompt_id:
            jobs[job_id] = {"status": "error", "error": "No prompt_id en respuesta"}
            return

        jobs[job_id] = {"status": "running", "progress": {"current": 0, "total": 1, "percent": 0}}

        # Iniciar WebSocket para progreso en paralelo
        ws_url = comfy_url.replace("http://", "ws://").replace("https://", "wss://") + f"/ws?clientId={client_id}"
        ws_thread = threading.Thread(target=listen_ws_progress, args=(ws_url, job_id, prompt_id))
        ws_thread.daemon = True
        ws_thread.start()

        # Esperar y obtener imagen (max 600s = 10 min para modelos pesados)
        for _ in range(600):
            time.sleep(1)
            try:
                history_res = requests.get(f"{comfy_url}/history/{prompt_id}", timeout=10)
                history = history_res.json()
            except Exception as e:
                continue
            if prompt_id in history:
                outputs = history[prompt_id].get("outputs", {})
                for node_id, node_output in outputs.items():
                    if "images" in node_output:
                        img_name = node_output["images"][0]["filename"]
                        img_data = requests.get(f"{comfy_url}/view?filename={img_name}&subfolder=&type=output").content
                        # Guardar en directorio temporal y devolver ruta absoluta (el frontend la convertirá a media:// en Electron)
                        out_dir = os.path.join(tempfile.gettempdir(), 'zms-flux')
                        os.makedirs(out_dir, exist_ok=True)
                        img_path = os.path.join(out_dir, f"flux-{uuid.uuid4().hex[:8]}.png")
                        with open(img_path, "wb") as f:
                            f.write(img_data)
                        jobs[job_id] = {"status": "completed", "image": {"url": img_path}, "progress": {"current": 1, "total": 1, "percent": 100}}
                        print(f"[Bridge] Job {job_id}: completado -> {img_path}")
                        return
                # Si llegó aquí, hay history pero sin imagen -> error
                jobs[job_id] = {"status": "error", "error": "Workflow completado pero sin imagen"}
                return

        jobs[job_id] = {"status": "error", "error": "Timeout esperando la imagen de ComfyUI"}
    except Exception as e:
        import traceback
        traceback.print_exc()
        jobs[job_id] = {"status": "error", "error": str(e)}


def _find_video_output(outputs):
    """Recorre los outputs de ComfyUI buscando el resultado de vídeo/imagen animada.
    Soporta SaveAnimatedWEBP/SaveImage (clave 'images'), VHS_VideoCombine (clave 'gifs')
    y nodos de vídeo personalizados (claves 'video' / 'animations').
    Devuelve (filename, subfolder, type) o None.
    """
    for node_id, node_output in outputs.items():
        for key in ("images", "gifs", "video", "animations"):
            items = node_output.get(key)
            if not items:
                continue
            item = items[0]
            fname = item.get("filename") or item.get("name")
            if not fname:
                continue
            return fname, item.get("subfolder", ""), item.get("type", "output")
    return None


def run_video_job(job_id, comfy_url, workflow):
    """Ejecuta un workflow de vídeo en ComfyUI en segundo plano y guarda el resultado."""
    try:
        client_id = str(uuid.uuid4())
        payload = {"prompt": workflow, "client_id": client_id}
        print(f"[Bridge-LTX] Job {job_id}: Enviando workflow a {comfy_url}/prompt")
        res = requests.post(f"{comfy_url}/prompt", json=payload)
        if not res.ok:
            error_text = res.text
            print(f"[Bridge-LTX] Job {job_id}: Error {res.status_code} de ComfyUI: {error_text}")
            jobs[job_id] = {"status": "error", "error": f"ComfyUI devolvió {res.status_code}: {error_text}"}
            return
        data = res.json()
        prompt_id = data.get("prompt_id")
        print(f"[Bridge-LTX] Job {job_id}: prompt_id={prompt_id}")
        if not prompt_id:
            jobs[job_id] = {"status": "error", "error": "No prompt_id en respuesta"}
            return

        jobs[job_id] = {"status": "running", "progress": {"current": 0, "total": max(len(workflow) if isinstance(workflow, dict) else 1, 1), "percent": 0}}

        ws_url = comfy_url.replace("http://", "ws://").replace("https://", "wss://") + f"/ws?clientId={client_id}"
        total_nodes = len(workflow) if isinstance(workflow, dict) else 0
        ws_thread = threading.Thread(target=listen_ws_progress, args=(ws_url, job_id, prompt_id, total_nodes))
        ws_thread.daemon = True
        ws_thread.start()

        for _ in range(1800):  # max 30 min (LTX-2.3 22B dos etapas + upscaler + audio tarda bastante)
            time.sleep(1)
            try:
                history_res = requests.get(f"{comfy_url}/history/{prompt_id}", timeout=10)
                history = history_res.json()
            except Exception:
                continue
            if prompt_id not in history:
                # Todavía no está en el historial (encolado o ejecutándose)
                continue

            entry = history[prompt_id]
            outputs = entry.get("outputs", {}) or {}
            status = entry.get("status", {}) or {}
            completed = status.get("completed", False)

            # ¿Ya hay salida de vídeo? (puede aparecer antes de que 'completed' sea True)
            found = _find_video_output(outputs)
            if found:
                fname, subfolder, out_type = found
                view_params = urllib.parse.urlencode({"filename": fname, "subfolder": subfolder, "type": out_type})
                vid_data = requests.get(f"{comfy_url}/view?{view_params}").content
                out_dir = os.path.join(tempfile.gettempdir(), 'zms-ltx')
                os.makedirs(out_dir, exist_ok=True)
                ext = os.path.splitext(fname)[1] or ".webm"
                vid_path = os.path.join(out_dir, f"ltx-{uuid.uuid4().hex[:8]}{ext}")
                with open(vid_path, "wb") as f:
                    f.write(vid_data)
                jobs[job_id] = {"status": "completed", "video": {"url": vid_path}, "progress": {"current": 1, "total": 1, "percent": 100}}
                print(f"[Bridge-LTX] Job {job_id}: completado -> {vid_path}")
                return

            # Sin salida aún: si NO ha terminado, seguir esperando (evita falsos "sin salida" por carrera)
            if not completed:
                continue

            # Terminó pero sin salida reconocida -> mirar mensajes de error de ComfyUI
            messages = status.get("messages", []) or []
            err_msg = None
            for m in messages:
                try:
                    if isinstance(m, list) and m and m[0] == "execution_error":
                        payload = m[1] if len(m) > 1 else m
                        if isinstance(payload, dict):
                            err_msg = payload.get('exception_message') or payload.get('node_message') or str(payload)
                            extra = []
                            if payload.get('node_type'): extra.append(f"nodo: {payload.get('node_type')}")
                            if payload.get('node_id'): extra.append(f"id: {payload.get('node_id')}")
                            if payload.get('exception_type'): extra.append(f"tipo: {payload.get('exception_type')}")
                            if extra: err_msg = err_msg + ' [' + ', '.join(extra) + ']'
                        else:
                            err_msg = str(payload)
                except Exception:
                    pass
            keys_hint = {nid: list(out.keys()) for nid, out in outputs.items()}
            base = f"Workflow completado pero sin salida de vídeo reconocida. Outputs: {keys_hint}"
            jobs[job_id] = {"status": "error", "error": (base + f" | execution_error: {err_msg}") if err_msg else base}
            return

        jobs[job_id] = {"status": "error", "error": "Timeout esperando el vídeo de ComfyUI"}
    except Exception as e:
        import traceback
        traceback.print_exc()
        jobs[job_id] = {"status": "error", "error": str(e)}


def _set_existing_key(inputs_dict, candidate_keys, value):
    """Asigna value a la primera clave de candidate_keys que exista en inputs_dict."""
    for k in candidate_keys:
        if k in inputs_dict:
            inputs_dict[k] = value
            return True
    return False


def upload_image_to_comfy(comfy_url, image_bytes, filename):
    """Sube una imagen al directorio input de ComfyUI y devuelve el nombre con el que quedó."""
    files = {"image": (filename, image_bytes)}
    data = {"overwrite": "true", "type": "input", "subfolder": ""}
    res = requests.post(f"{comfy_url}/upload/image", files=files, data=data, timeout=30)
    if not res.ok:
        raise Exception(f"ComfyUI /upload/image devolvió {res.status_code}: {res.text}")
    body = res.json()
    name = body.get("name")
    if not name:
        raise Exception(f"ComfyUI /upload/image no devolvió 'name': {body}")
    return name


@app.route('/flux/', methods=['POST', 'OPTIONS'])
def flux_generate():
    if request.method == 'OPTIONS':
        return jsonify({"status": "ok"}), 200

    try:
        prompt = request.form.get('prompt', '')
        comfy_url = request.form.get('comfyui_url', COMFY_UI_URL)
        steps = int(request.form.get('steps', 4))
        cfg = float(request.form.get('cfg', 1.0))
        seed = int(request.form.get('seed', -1))
        strength = float(request.form.get('strength', 1.0))

        image_file = request.files.get('image_file')
        mask_file = request.files.get('mask_file')

        # Verificar que ComfyUI está vivo
        try:
            system_info = requests.get(f"{comfy_url}/system_stats", timeout=5)
            system_info.raise_for_status()
            print("[Bridge] ComfyUI conectado correctamente.")
        except Exception as e:
            return jsonify({"error": f"ComfyUI no está disponible en {comfy_url}. Asegúrate de ejecutar python main.py en F:\\ComfyUI. Error: {str(e)}"}), 503

        # Generar un workflow para Flux (checkpoint completo + ModelSamplingFlux)
        seed_val = seed if seed != -1 else uuid.uuid4().int % 2**32
        workflow = {
            "1": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": {
                    "ckpt_name": "flux1-schnell-fp8.safetensors"
                }
            },
            "2": {
                "class_type": "EmptyLatentImage",
                "inputs": {
                    "width": 1024,
                    "height": 1024,
                    "batch_size": 1
                }
            },
            "3": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "clip": ["1", 1],
                    "text": prompt
                }
            },
            "3b": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "clip": ["1", 1],
                    "text": ""
                }
            },
            "4": {
                "class_type": "FluxGuidance",
                "inputs": {
                    "conditioning": ["3", 0],
                    "guidance": 3.5
                }
            },
            "5": {
                "class_type": "ModelSamplingFlux",
                "inputs": {
                    "model": ["1", 0],
                    "max_shift": 1.15,
                    "base_shift": 0.5,
                    "width": 1024,
                    "height": 1024
                }
            },
            "6": {
                "class_type": "KSampler",
                "inputs": {
                    "model": ["5", 0],
                    "positive": ["4", 0],
                    "negative": ["3b", 0],
                    "latent_image": ["2", 0],
                    "seed": seed_val,
                    "steps": steps,
                    "cfg": 1.0,
                    "sampler_name": "euler",
                    "scheduler": "simple",
                    "denoise": strength
                }
            },
            "7": {
                "class_type": "VAEDecode",
                "inputs": {
                    "samples": ["6", 0],
                    "vae": ["1", 2]
                }
            },
            "8": {
                "class_type": "SaveImage",
                "inputs": {
                    "images": ["7", 0],
                    "filename_prefix": "flux_output"
                }
            }
        }

        # Crear job y lanzar en segundo plano
        job_id = str(uuid.uuid4())
        jobs[job_id] = {"status": "pending"}
        thread = threading.Thread(target=run_job, args=(job_id, comfy_url, prompt, workflow))
        thread.start()

        return jsonify({"job_id": job_id, "status": "pending"})

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/flux/status/<job_id>', methods=['GET'])
def flux_status(job_id):
    """Devuelve el estado actual de un job."""
    if job_id not in jobs:
        return jsonify({"status": "not_found"}), 404
    return jsonify(jobs[job_id])


@app.route('/ltx/', methods=['POST', 'OPTIONS'])
def ltx_generate():
    if request.method == 'OPTIONS':
        return jsonify({"status": "ok"}), 200

    try:
        comfy_url = request.form.get('comfyui_url', COMFY_UI_URL)
        workflow_json = request.form.get('workflow_json', '')
        prompt = request.form.get('prompt', '')
        negative = request.form.get('negative', '')
        seed = int(request.form.get('seed', -1))
        frames = request.form.get('frames', '')
        fps = request.form.get('fps', '')

        prompt_node = request.form.get('prompt_node', '').strip()
        negative_node = request.form.get('negative_node', '').strip()
        seed_node = request.form.get('seed_node', '').strip()
        image_node = request.form.get('image_node', '').strip()
        frames_node = request.form.get('frames_node', '').strip()
        fps_node = request.form.get('fps_node', '').strip()
        width_node = request.form.get('width_node', '').strip()
        height_node = request.form.get('height_node', '').strip()
        width = request.form.get('width', '')
        height = request.form.get('height', '')
        t2v_switch_node = request.form.get('t2v_switch_node', '').strip()

        image_file = request.files.get('image_file')

        if not workflow_json:
            return jsonify({"error": "Falta workflow_json (exporta tu workflow de ComfyUI en formato API)."}), 400
        if not prompt.strip():
            return jsonify({"error": "Falta el prompt."}), 400
        if not prompt_node:
            return jsonify({"error": "Falta el ID del nodo de prompt (prompt_node)."}), 400

        try:
            workflow = json.loads(workflow_json)
        except Exception as e:
            return jsonify({"error": f"workflow_json no es JSON válido: {e}"}), 400

        # Verificar que ComfyUI está vivo
        try:
            requests.get(f"{comfy_url}/system_stats", timeout=5).raise_for_status()
        except Exception as e:
            return jsonify({"error": f"ComfyUI no está disponible en {comfy_url}. Error: {e}"}), 503

        # Modo texto-a-vídeo: activar el nodo booleano "Switch to Text to Video" (si lo hay)
        if t2v_switch_node:
            if t2v_switch_node in workflow and "inputs" in workflow[t2v_switch_node]:
                _set_existing_key(workflow[t2v_switch_node]["inputs"], ["value", "boolean", "enabled"], True)
                print(f"[Bridge-LTX] Modo texto-a-vídeo: nodo {t2v_switch_node} activado")

        # Subir imagen de entrada (i2v) y fijar el nodo LoadImage
        if image_node or image_file:
            if not image_file:
                return jsonify({"error": "Modo imagen-a-vídeo: indicaste un nodo de imagen pero no se envió image_file."}), 400
            img_bytes = image_file.read()
            safe_name = (image_file.filename or "ltx_input.png").replace('\\', '/').split('/')[-1]
            uploaded_name = upload_image_to_comfy(comfy_url, img_bytes, safe_name)
            # Si image_node apunta a un LoadImage real, fijamos SÓLO ese (sin pisar otros
            # LoadImage del workflow, p.ej. uno usado como máscara). Pero si image_node no
            # existe o NO es un LoadImage (p.ej. el usuario puso el ID del Resize 320:290
            # en su lugar), el override caería en una clave muerta y el LoadImage real
            # seguiría con su imagen por defecto -> el vídeo salía con la imagen que ya
            # estaba en ComfyUI. En ese caso fijamos TODOS los LoadImage del workflow para
            # garantizar que el que alimenta el pipeline reciba la imagen subida.
            target_is_loadimage = (
                image_node in workflow
                and isinstance(workflow.get(image_node), dict)
                and workflow[image_node].get("class_type") == "LoadImage"
            )
            if target_is_loadimage:
                workflow[image_node]["inputs"]["image"] = uploaded_name
                print(f"[Bridge-LTX] Imagen subida como '{uploaded_name}' en nodo LoadImage {image_node}")
            else:
                loadimage_ids = [nid for nid, n in workflow.items()
                                 if isinstance(n, dict) and n.get("class_type") == "LoadImage"]
                for nid in loadimage_ids:
                    workflow[nid]["inputs"]["image"] = uploaded_name
                print(f"[Bridge-LTX] image_node='{image_node or '—'}' no es un LoadImage o no existe; "
                      f"imagen '{uploaded_name}' fijada en todos los LoadImage: {loadimage_ids}")

        # Inyectar prompt (CLIPTextEncode usa 'text'; PrimitiveString/Multiline usa 'value')
        if prompt_node not in workflow or "inputs" not in workflow[prompt_node]:
            return jsonify({"error": f"El nodo prompt_node='{prompt_node}' no existe en el workflow."}), 400
        if not _set_existing_key(workflow[prompt_node]["inputs"], ["text", "value"], prompt):
            workflow[prompt_node]["inputs"]["text"] = prompt  # fallback: crear 'text'

        # Inyectar prompt negativo
        if negative_node:
            if negative_node in workflow and "inputs" in workflow[negative_node]:
                _set_existing_key(workflow[negative_node]["inputs"], ["text", "value"], negative)

        # Inyectar seed (KSampler usa 'seed'; RandomNoise usa 'noise_seed')
        if seed_node:
            seed_val = seed if seed != -1 else (uuid.uuid4().int % 2**32)
            if seed_node in workflow and "inputs" in workflow[seed_node]:
                _set_existing_key(workflow[seed_node]["inputs"], ["seed", "noise_seed"], seed_val)

        # Inyectar número de frames (EmptyLTXVLatentVideo: 'length'; PrimitiveInt: 'value')
        if frames_node and frames:
            if frames_node in workflow and "inputs" in workflow[frames_node]:
                _set_existing_key(workflow[frames_node]["inputs"], ["length", "batch_size", "frames", "num_frames", "value"], int(frames))

        # Inyectar fps (CreateVideo: 'fps'; PrimitiveInt Frame Rate: 'value')
        if fps_node and fps:
            if fps_node in workflow and "inputs" in workflow[fps_node]:
                _set_existing_key(workflow[fps_node]["inputs"], ["fps", "frame_rate", "frames_per_second", "value"], float(fps))

        # Inyectar ancho/alto del recorte (PrimitiveInt Width/Height: 'value'; ResizeImageMaskNode: 'width'/'height')
        if width_node and width:
            if width_node in workflow and "inputs" in workflow[width_node]:
                _set_existing_key(workflow[width_node]["inputs"], ["value", "width"], int(width))
        if height_node and height:
            if height_node in workflow and "inputs" in workflow[height_node]:
                _set_existing_key(workflow[height_node]["inputs"], ["value", "height"], int(height))

        job_id = str(uuid.uuid4())
        jobs[job_id] = {"status": "pending"}
        thread = threading.Thread(target=run_video_job, args=(job_id, comfy_url, workflow))
        thread.start()

        return jsonify({"job_id": job_id, "status": "pending"})

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route('/ltx/status/<job_id>', methods=['GET'])
def ltx_status(job_id):
    """Devuelve el estado actual de un job de vídeo LTX."""
    if job_id not in jobs:
        return jsonify({"status": "not_found"}), 404
    return jsonify(jobs[job_id])


# ---------------------------------------------------------------------------
# Mejorar calidad de un vídeo con ComfyUI (reescalado IA + interpolación RIFE).
# El usuario aporta su propio workflow exportado en formato API (con VHS
# LoadVideo, UpscaleModelLoader + ImageUpscaleWithModel, opcional VFI/RIFE y
# VHS VideoCombine/SaveVideo) y el bridge inyecta por ID de nodo:
#   - el vídeo de entrada (subido al input dir de ComfyUI) en el nodo LoadVideo
#   - el nombre del modelo upscaler en el nodo UpscaleModelLoader
#   - el frame_rate de interpolación en el nodo VFI (opcional)
# Como ImageUpscaleWithModel reserva el buffer de salida completo para todos los
# frames a la vez, un 4x de un vídeo de 1080p necesita >100GB de RAM y revienta.
# Por eso el bridge trocea el vídeo (VHS skip_first_frames + frame_load_cap),
# ejecuta el workflow por trozos y luego une los trozos con ffmpeg.
# ---------------------------------------------------------------------------


def _ffmpeg_bin():
    """Devuelve el ejecutable de ffmpeg (busca en PATH)."""
    for cand in ("ffmpeg", "ffmpeg.exe"):
        try:
            r = subprocess.run(["where", cand], capture_output=True, text=True, shell=False)
            if r.returncode == 0 and r.stdout.strip():
                return r.stdout.strip().splitlines()[0]
        except Exception:
            pass
    # último recurso: ruta conocida del winget de Gyan
    gyan = os.path.expandvars(r"C:\Users\exchi\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1.2-full_build\bin\ffmpeg.exe")
    return gyan if os.path.exists(gyan) else "ffmpeg"


def _ffprobe_bin():
    for cand in ("ffprobe", "ffprobe.exe"):
        try:
            r = subprocess.run(["where", cand], capture_output=True, text=True, shell=False)
            if r.returncode == 0 and r.stdout.strip():
                return r.stdout.strip().splitlines()[0]
        except Exception:
            pass
    gyan = os.path.expandvars(r"C:\Users\exchi\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1.2-full_build\bin\ffprobe.exe")
    return gyan if os.path.exists(gyan) else "ffprobe"


def _probe_video_fps_duration(ffprobe, path):
    """Devuelve (fps, duration, width, height). fps como float."""
    try:
        r = subprocess.run(
            [ffprobe, "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=r_frame_rate,width,height:format=duration",
             "-of", "json", path],
            capture_output=True, text=True, timeout=30)
        d = json.loads(r.stdout or "{}")
        st = (d.get("streams") or [{}])[0]
        fps = 30.0
        rfr = st.get("r_frame_rate", "30/1")
        if "/" in rfr:
            num, den = rfr.split("/")
            den_f = float(den) if float(den) != 0 else 1.0
            fps = float(num) / den_f
        w = int(st.get("width") or 0)
        h = int(st.get("height") or 0)
        dur = float(d.get("format", {}).get("duration") or 0)
        if dur == 0:
            dur = 0.0
        return fps, dur, w, h
    except Exception as e:
        print(f"[Bridge-ENHANCE] ffprobe falló: {e}")
        return 30.0, 0.0, 0, 0


def _execute_one_video_workflow(comfy_url, workflow, on_progress=None, total_nodes=0):
    """Ejecuta UN workflow de vídeo en ComfyUI y devuelve (vid_path, error).
    on_progress(pct_0_92) se llama con el progreso de esta ejecución concreta."""
    try:
        client_id = str(uuid.uuid4())
        payload = {"prompt": workflow, "client_id": client_id}
        res = requests.post(f"{comfy_url}/prompt", json=payload, timeout=60)
        if not res.ok:
            return None, f"ComfyUI devolvió {res.status_code}: {res.text[:300]}"
        data = res.json()
        prompt_id = data.get("prompt_id")
        if not prompt_id:
            return None, "No prompt_id en respuesta"

        ws_url = comfy_url.replace("http://", "ws://").replace("https://", "wss://") + f"/ws?clientId={client_id}"
        local = {"pct": 0, "seen": 0}

        def on_message(ws, message):
            try:
                msg = json.loads(message)
                mt = msg.get("type", "")
                d = msg.get("data", {})
                if mt == "progress":
                    c = d.get("value", 0); t = d.get("max", 1)
                    local["pct"] = int(c / t * 90)
                elif mt == "execution_start" and d.get("prompt_id") == prompt_id:
                    local["pct"] = max(local["pct"], 2)
                elif mt == "executing" and d.get("prompt_id") == prompt_id:
                    node = d.get("node")
                    if node is None:
                        local["pct"] = 92
                    else:
                        local["seen"] = local["seen"] + 1
                        if total_nodes:
                            local["pct"] = int(min(90, local["seen"] / total_nodes * 90))
                elif mt == "execution_cached" and d.get("prompt_id") == prompt_id:
                    local["seen"] = local["seen"] + len(d.get("nodes", []) or [])
                    if total_nodes:
                        local["pct"] = int(min(90, local["seen"] / total_nodes * 90))
                if on_progress:
                    on_progress(local["pct"])
            except Exception:
                pass

        ws = websocket.WebSocketApp(ws_url, on_message=on_message)
        wst = threading.Thread(target=ws.run_forever, daemon=True)
        wst.start()

        for _ in range(1800):
            time.sleep(1)
            try:
                hist = requests.get(f"{comfy_url}/history/{prompt_id}", timeout=10).json()
            except Exception:
                continue
            if prompt_id not in hist:
                continue
            entry = hist[prompt_id]
            outputs = entry.get("outputs", {}) or {}
            status = entry.get("status", {}) or {}
            completed = status.get("completed", False)
            found = _find_video_output(outputs)
            if found:
                fname, subfolder, out_type = found
                vp = urllib.parse.urlencode({"filename": fname, "subfolder": subfolder, "type": out_type})
                vid = requests.get(f"{comfy_url}/view?{vp}", timeout=120).content
                out_dir = os.path.join(tempfile.gettempdir(), "zms-enhance")
                os.makedirs(out_dir, exist_ok=True)
                ext = os.path.splitext(fname)[1] or ".mp4"
                p = os.path.join(out_dir, f"en-{uuid.uuid4().hex[:8]}{ext}")
                with open(p, "wb") as f:
                    f.write(vid)
                try:
                    ws.close()
                except Exception:
                    pass
                return p, None
            if not completed:
                continue
            msgs = status.get("messages", []) or []
            err = None
            for m in msgs:
                try:
                    if isinstance(m, list) and m and m[0] == "execution_error":
                        pl = m[1] if len(m) > 1 else m
                        if isinstance(pl, dict):
                            err = pl.get("exception_message") or str(pl)
                            extra = []
                            if pl.get("node_type"):
                                extra.append(f"nodo: {pl.get('node_type')}")
                            if pl.get("node_id"):
                                extra.append(f"id: {pl.get('node_id')}")
                            if extra:
                                err = err + " [" + ", ".join(extra) + "]"
                        else:
                            err = str(pl)
                except Exception:
                    pass
            try:
                ws.close()
            except Exception:
                pass
            return None, err or "Workflow completado sin salida de vídeo"
        try:
            ws.close()
        except Exception:
            pass
        return None, "Timeout esperando el vídeo de ComfyUI"
    except Exception as e:
        return None, str(e)


def run_enhance_chunked(job_id, comfy_url, base_workflow, loadvideo_node, ffmpeg_path, ffprobe_path):
    """Trocea el vídeo de entrada, ejecuta el workflow por trozos y concatena."""
    try:
        total_nodes = len(base_workflow) if isinstance(base_workflow, dict) else 0
        lv_inputs = base_workflow.get(loadvideo_node, {}).get("inputs", {}) or {}

        # El vídeo ya está inyectado en lv_inputs['video'] (nombre en input dir de ComfyUI).
        # Pero necesitamos la ruta local del vídeo subido para trocear con ffprobe.
        # En enhance_generate guardamos la ruta en el workflow temporal del job; aquí leemos
        # el nombre que se subió y lo localizamos en el input dir de ComfyUI.
        uploaded_name = lv_inputs.get("video") or lv_inputs.get("path") or lv_inputs.get("filename") or lv_inputs.get("value")
        comfy_input_dir = _comfy_input_dir(comfy_url)
        local_video = os.path.join(comfy_input_dir, uploaded_name) if (comfy_input_dir and uploaded_name) else None

        if not local_video or not os.path.exists(local_video):
            jobs[job_id] = {"status": "error", "error": f"No se encontró el vídeo subido para trocear: {local_video}"}
            return

        fps, duration, w, h = _probe_video_fps_duration(ffprobe_path, local_video)
        if duration <= 0:
            jobs[job_id] = {"status": "error", "error": "ffprobe no pudo leer la duración del vídeo."}
            return

        fr = lv_inputs.get("force_rate", 30)
        if (fr is None) or (isinstance(fr, (int, float)) and fr == 0):
            eff_fps = fps
        else:
            try:
                eff_fps = float(fr)
            except Exception:
                eff_fps = 30.0
        total_frames = max(1, int(round(duration * eff_fps)))

        # Tamaño del trozo: limitar el buffer de salida del upscale a ~3 GB.
        # Asumimos el peor caso (4x => 16x area): bytes por frame de salida = W*H*16*3*4 = 192*W*H.
        per_frame_bytes = max(1, (w or 1920) * (h or 1080) * 192)
        RAM_BUDGET = 3 * 1024 ** 3
        chunk_frames = max(2, int(RAM_BUDGET // per_frame_bytes))
        chunk_frames = min(chunk_frames, 60)
        total_chunks = max(1, int(math.ceil(total_frames / chunk_frames)))

        print(f"[Bridge-ENHANCE] Trocear: {total_frames} frames @ {eff_fps}fps -> {total_chunks} trozos de {chunk_frames} frames (vídeo {w}x{h})")
        jobs[job_id] = {"status": "running", "progress": {"current": 0, "total": total_chunks, "percent": 2}}

        out_dir = os.path.join(tempfile.gettempdir(), "zms-enhance")
        os.makedirs(out_dir, exist_ok=True)
        chunk_paths = []

        for ci in range(total_chunks):
            wf = json.loads(json.dumps(base_workflow))  # deep copy
            lv = wf.get(loadvideo_node, {}).get("inputs", {})
            lv["skip_first_frames"] = ci * chunk_frames
            lv["frame_load_cap"] = chunk_frames
            for k in ("meta_batch", "vae"):
                if k in lv and lv[k] is not None and not isinstance(lv[k], (dict, list)):
                    lv[k] = None
            if "frame_load_cap" in lv:
                try:
                    lv["frame_load_cap"] = int(lv["frame_load_cap"])
                except Exception:
                    lv["frame_load_cap"] = chunk_frames

            def on_prog(p, ci=ci):
                overall = int((ci + max(0, p) / 92.0) / total_chunks * 93) + 2
                if job_id in jobs:
                    jobs[job_id]["progress"] = {"current": ci, "total": total_chunks, "percent": min(95, overall)}

            vid, err = _execute_one_video_workflow(comfy_url, wf, on_progress=on_prog, total_nodes=total_nodes)
            if err:
                jobs[job_id] = {"status": "error", "error": f"Trozo {ci + 1}/{total_chunks}: {err}"}
                for cp in chunk_paths:
                    try:
                        os.remove(cp)
                    except Exception:
                        pass
                return
            if vid:
                chunk_paths.append(vid)
            if job_id in jobs:
                jobs[job_id]["progress"] = {"current": ci + 1, "total": total_chunks, "percent": min(95, int((ci + 1) / total_chunks * 93) + 2)}

        if not chunk_paths:
            jobs[job_id] = {"status": "error", "error": "No se generó ningún trozo."}
            return

        # Concatenar trozos con ffmpeg
        if job_id in jobs:
            jobs[job_id]["progress"] = {"current": total_chunks, "total": total_chunks, "percent": 96}
        list_path = os.path.join(out_dir, f"list-{job_id}.txt")
        with open(list_path, "w") as f:
            for cp in chunk_paths:
                ap = os.path.abspath(cp).replace("\\", "/")
                f.write(f"file '{ap}'\n")
        final = os.path.join(out_dir, f"enhance-{uuid.uuid4().hex[:8]}.mp4")

        # Intentar stream copy (rápido); si falla, re-encodear
        proc = subprocess.run(
            [ffmpeg_path, "-y", "-f", "concat", "-safe", "0", "-i", list_path, "-c", "copy", final],
            capture_output=True, text=True, timeout=600)
        if proc.returncode != 0 or not os.path.exists(final) or os.path.getsize(final) == 0:
            if os.path.exists(final):
                try:
                    os.remove(final)
                except Exception:
                    pass
            proc = subprocess.run(
                [ffmpeg_path, "-y", "-f", "concat", "-safe", "0", "-i", list_path,
                 "-c:v", "libx264", "-preset", "fast", "-crf", "18",
                 "-pix_fmt", "yuv420p", "-movflags", "+faststart", final],
                capture_output=True, text=True, timeout=3600)
            if proc.returncode != 0 or not os.path.exists(final) or os.path.getsize(final) == 0:
                jobs[job_id] = {"status": "error", "error": f"ffmpeg concat falló: {(proc.stderr or '')[-500:]}"}
                return

        for cp in chunk_paths:
            try:
                os.remove(cp)
            except Exception:
                pass
        try:
            os.remove(list_path)
        except Exception:
            pass

        jobs[job_id] = {"status": "completed", "video": {"url": final},
                        "progress": {"current": total_chunks, "total": total_chunks, "percent": 100}}
        print(f"[Bridge-ENHANCE] Job {job_id}: completado (troceado, {total_chunks} trozos) -> {final}")
    except Exception as e:
        import traceback
        traceback.print_exc()
        jobs[job_id] = {"status": "error", "error": str(e)}


def _comfy_input_dir(comfy_url):
    """Intenta averiguar el directorio 'input' de ComfyUI consultando /object_info o usando la ruta por defecto."""
    # ComfyUI guarda los uploads en <comfy_dir>/input. No hay endpoint directo para saber la ruta,
    # así que probamos la ruta estándar de la instalación conocida (F:\ComfyUI\input).
    candidates = [r"F:\ComfyUI\input", r"C:\ComfyUI\input"]
    for c in candidates:
        if os.path.isdir(c):
            return c
    return None
@app.route('/enhance/', methods=['POST', 'OPTIONS'])
def enhance_generate():
    if request.method == 'OPTIONS':
        return jsonify({"status": "ok"}), 200

    try:
        comfy_url = request.form.get('comfyui_url', COMFY_UI_URL)
        workflow_json = request.form.get('workflow_json', '')

        loadvideo_node = request.form.get('loadvideo_node', '').strip()
        upscaler_node = request.form.get('upscaler_node', '').strip()
        upscaler_model = request.form.get('upscaler_model', '').strip()
        vfi_node = request.form.get('vfi_node', '').strip()
        vfi_fps = request.form.get('vfi_fps', '').strip()

        video_file = request.files.get('video_file')

        if not workflow_json:
            return jsonify({"error": "Falta workflow_json (exporta tu workflow de mejora en formato API)."}), 400
        if not video_file:
            return jsonify({"error": "Falta el vídeo de entrada (video_file)."}), 400
        if not loadvideo_node:
            return jsonify({"error": "Falta el ID del nodo LoadVideo (loadvideo_node)."}), 400

        try:
            workflow = json.loads(workflow_json)
        except Exception as e:
            return jsonify({"error": f"workflow_json no es JSON válido: {e}"}), 400

        # Verificar que ComfyUI está vivo
        try:
            requests.get(f"{comfy_url}/system_stats", timeout=5).raise_for_status()
        except Exception as e:
            return jsonify({"error": f"ComfyUI no está disponible en {comfy_url}. Error: {e}"}), 503

        # Subir el vídeo de entrada al directorio input de ComfyUI. El endpoint
        # /upload/image sirve para cualquier archivo (VHS LoadVideo lee del input dir).
        vid_bytes = video_file.read()
        safe_name = (video_file.filename or "enhance_input.mp4").replace('\\', '/').split('/')[-1]
        uploaded_name = upload_image_to_comfy(comfy_url, vid_bytes, safe_name)
        print(f"[Bridge-ENHANCE] Vídeo subido como '{uploaded_name}'")

        # Inyectar el vídeo en el nodo LoadVideo (VHS usa 'video'; otros 'path'/'value')
        if loadvideo_node not in workflow or "inputs" not in workflow[loadvideo_node]:
            return jsonify({"error": f"El nodo loadvideo_node='{loadvideo_node}' no existe en el workflow."}), 400
        if not _set_existing_key(workflow[loadvideo_node]["inputs"], ["video", "path", "filename", "value"], uploaded_name):
            workflow[loadvideo_node]["inputs"]["video"] = uploaded_name
        print(f"[Bridge-ENHANCE] Vídeo fijado en nodo {loadvideo_node}")

        # VHS_LoadVideo revienta si 'meta_batch' o 'vae' llegan como bool (false)
        # en vez de null: hace meta_batch.inputs -> AttributeError. Forzar null aquí
        # para que el workflow del usuario tenga estos campos correctos siquiera.
        lv_inputs = workflow[loadvideo_node]["inputs"]
        for k in ("meta_batch", "vae"):
            if k in lv_inputs and lv_inputs[k] is not None and not isinstance(lv_inputs[k], (dict, list)):
                lv_inputs[k] = None
        # frame_load_cap=0 puede dar problemas; asegurar entero >=0
        if "frame_load_cap" in lv_inputs:
            try: lv_inputs["frame_load_cap"] = int(lv_inputs["frame_load_cap"])
            except Exception: lv_inputs["frame_load_cap"] = 0

        # Inyectar el modelo upscaler en el nodo UpscaleModelLoader (input 'model_name')
        if upscaler_node and upscaler_model:
            if upscaler_node in workflow and "inputs" in workflow[upscaler_node]:
                if not _set_existing_key(workflow[upscaler_node]["inputs"], ["model_name", "model", "value"], upscaler_model):
                    workflow[upscaler_node]["inputs"]["model_name"] = upscaler_model
                print(f"[Bridge-ENHANCE] Modelo upscaler '{upscaler_model}' en nodo {upscaler_node}")

        # Inyectar el frame_rate de interpolación en el nodo VFI (VHS_VFI usa 'frame_rate')
        if vfi_node and vfi_fps:
            if vfi_node in workflow and "inputs" in workflow[vfi_node]:
                _set_existing_key(workflow[vfi_node]["inputs"], ["frame_rate", "fps", "value"], float(vfi_fps))
                print(f"[Bridge-ENHANCE] FPS {vfi_fps} en nodo VFI {vfi_node}")

        job_id = str(uuid.uuid4())
        jobs[job_id] = {"status": "pending"}
        ffmpeg_path = _ffmpeg_bin()
        ffprobe_path = _ffprobe_bin()
        thread = threading.Thread(target=run_enhance_chunked,
                                   args=(job_id, comfy_url, workflow, loadvideo_node, ffmpeg_path, ffprobe_path))
        thread.start()

        return jsonify({"job_id": job_id, "status": "pending"})

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route('/enhance/status/<job_id>', methods=['GET'])
def enhance_status(job_id):
    """Devuelve el estado actual de un job de mejora de vídeo."""
    if job_id not in jobs:
        return jsonify({"status": "not_found"}), 404
    return jsonify(jobs[job_id])


@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "ok"})


# ---------------------------------------------------------------------------
# SAM2 — segmentación de vídeo con IA vía ComfyUI.
# El usuario aporta un workflow SAM2 exportado en formato API (con un nodo
# LoadVideo para el vídeo fuente y un nodo LoadImage para la máscara del frame
# inicial). El bridge sube el vídeo y la máscara al input dir de ComfyUI y los
# inyecta POR ID de nodo (sin pisar otros LoadImage/LoadVideo del workflow),
# lanza el workflow y devuelve el vídeo de máscaras que produce. El frontend lo
# decodifica a PNGs por frame y construye motionMasks (silueta cambiante).
# ---------------------------------------------------------------------------

@app.route('/sam2/', methods=['POST', 'OPTIONS'])
def sam2_segment():
    if request.method == 'OPTIONS':
        return jsonify({"status": "ok"}), 200

    try:
        comfy_url = request.form.get('comfyui_url', COMFY_UI_URL)
        workflow_json = request.form.get('workflow_json', '')
        video_load_node = request.form.get('video_load_node', '').strip()
        # --- Modo puntos (video segmentor, recomendado) ---
        # points_node: ID del nodo que aporta la cadena coordinates_positive a Sam2Segmentation
        # / Sam2VideoSegmentationAddPoints (normalmente un PrimitiveNode cuyo widget "value"
        # es el STRING JSON [{"x":..,"y":..}]; forceInput=True exige que venga de un nodo).
        points_node = request.form.get('points_node', '').strip()
        coordinates = request.form.get('coordinates', '').strip()
        frame_node = request.form.get('frame_node', '').strip()
        frame_index = request.form.get('frame_index', '').strip()
        # --- Modo máscara (single_image, sin propagación; legacy/secundario) ---
        mask_image_node = request.form.get('mask_image_node', '').strip()
        # Params genéricos por node-ID: JSON { "<node_id>": { "<key>": <value> } }
        node_params_json = request.form.get('node_params', '')

        video_file = request.files.get('video_file')
        mask_file = request.files.get('mask_file')

        if not workflow_json:
            return jsonify({"error": "Falta workflow_json (exporta tu workflow SAM2 de ComfyUI en formato API)."}), 400
        if not video_load_node:
            return jsonify({"error": "Falta el ID del nodo de vídeo (video_load_node, un LoadVideo/VHS LoadVideo)."}), 400
        # Al menos un modo: puntos (recomendado) o máscara (secundario).
        points_mode = bool(points_node and coordinates)
        mask_mode = bool(mask_image_node and mask_file)
        if not points_mode and not mask_mode:
            return jsonify({"error": "Falta el modo de prompt: envía points_node+coordinates (modo vídeo, recomendado) o mask_image_node+mask_file (modo single_image)."}), 400

        try:
            workflow = json.loads(workflow_json)
        except Exception as e:
            return jsonify({"error": f"workflow_json no es JSON válido: {e}"}), 400

        # Validar el nodo de vídeo (debe ser LoadVideo/VHS).
        vnode = workflow.get(video_load_node)
        if not isinstance(vnode, dict) or "inputs" not in vnode:
            return jsonify({"error": f"El nodo video_load_node='{video_load_node}' no existe en el workflow."}), 400
        vtype = vnode.get("class_type", "")
        if vtype not in ("LoadVideo", "VHS_LoadVideo", "VHS_LoadVideoPath"):
            return jsonify({"error": f"video_load_node='{video_load_node}' es '{vtype}', no un LoadVideo. Usa el ID del nodo que carga el vídeo."}), 400

        # Verificar que ComfyUI está vivo
        try:
            requests.get(f"{comfy_url}/system_stats", timeout=5).raise_for_status()
        except Exception as e:
            return jsonify({"error": f"ComfyUI no está disponible en {comfy_url}. Error: {e}"}), 503

        # Subir el vídeo fuente al input dir de ComfyUI y fijar el nodo LoadVideo.
        if not video_file:
            return jsonify({"error": "Falta video_file (el vídeo fuente del clip)."}), 400
        vid_bytes = video_file.read()
        vid_safe = (video_file.filename or "sam2_source.mp4").replace('\\', '/').split('/')[-1]
        uploaded_video = upload_image_to_comfy(comfy_url, vid_bytes, vid_safe)
        # VHS_LoadVideo usa 'video'; LoadVideo nativo usa 'video' o 'filename'.
        if not _set_existing_key(vnode["inputs"], ["video", "filename", "value"], uploaded_video):
            vnode["inputs"]["video"] = uploaded_video
        print(f"[Bridge-SAM2] Vídeo subido como '{uploaded_video}' en nodo {video_load_node} ({vtype})")

        if points_mode:
            # Inyectar la cadena de puntos como LITERAL en el input coordinates_positive
            # del nodo de segmentación (Sam2Segmentation / Sam2VideoSegmentationAddPoints).
            # El formato API de ComfyUI acepta literales en inputs forceInput (forceInput
            # es sólo una restricción de la UI); la validación hace val=str(val) para STRING.
            # No usamos PrimitiveNode porque no está registrado en el backend (sólo frontend).
            pnode = workflow.get(points_node)
            if not isinstance(pnode, dict) or "inputs" not in pnode:
                return jsonify({"error": f"El nodo points_node='{points_node}' no existe en el workflow."}), 400
            pnode["inputs"]["coordinates_positive"] = coordinates
            print(f"[Bridge-SAM2] Puntos inyectados en coordinates_positive del nodo {points_node} ({pnode.get('class_type')}): {coordinates}")
            # frame_index del prompt (índice de frame al que corresponden los puntos).
            # Se aplica en el nodo frame_node si existe; si no, en el PROPIO nodo de
            # segmentación (Sam2Segmentation en modo vídeo), que es donde se aplican
            # los puntos. Antes sólo se inyectaba vía frame_node con _set_existing_key
            # (y sólo si la clave ya existía en el JSON): si el workflow no traía la
            # clave o no había frame_node, los puntos caían SIEMPRE en el frame 0 —
            # la segunda pasada (lazo en un frame distinto del 0) no cubría la zona
            # dibujada porque SAM2 recibía el prompt en el frame equivocado.
            if frame_index:
                target_inputs = None
                target_name = ''
                if frame_node and frame_node in workflow and "inputs" in workflow[frame_node]:
                    target_inputs = workflow[frame_node]["inputs"]
                    target_name = frame_node
                elif pnode is not None:
                    target_inputs = pnode["inputs"]
                    target_name = points_node
                if target_inputs is not None:
                    if not _set_existing_key(target_inputs, ["frame_index", "frame", "value"], int(frame_index)):
                        target_inputs["frame_index"] = int(frame_index)
                    print(f"[Bridge-SAM2] Frame {frame_index} en nodo {target_name}")

        if mask_mode:
            mnode = workflow.get(mask_image_node)
            if not isinstance(mnode, dict) or "inputs" not in mnode:
                return jsonify({"error": f"El nodo mask_image_node='{mask_image_node}' no existe en el workflow."}), 400
            if mnode.get("class_type") != "LoadImage":
                return jsonify({"error": f"mask_image_node='{mask_image_node}' es '{mnode.get('class_type')}', no un LoadImage. Usa el ID del nodo que carga la máscara."}), 400
            mask_bytes = mask_file.read()
            mask_safe = (mask_file.filename or "sam2_mask.png").replace('\\', '/').split('/')[-1]
            uploaded_mask = upload_image_to_comfy(comfy_url, mask_bytes, mask_safe)
            mnode["inputs"]["image"] = uploaded_mask
            print(f"[Bridge-SAM2] Máscara subida como '{uploaded_mask}' en nodo LoadImage {mask_image_node}")

        # Params genéricos por node-ID (power user).
        if node_params_json:
            try:
                node_params = json.loads(node_params_json)
                for nid, kv in node_params.items():
                    if nid in workflow and isinstance(workflow[nid], dict) and "inputs" in workflow[nid] and isinstance(kv, dict):
                        for k, v in kv.items():
                            workflow[nid]["inputs"][k] = v
            except Exception as e:
                print(f"[Bridge-SAM2] node_params ignorado (JSON inválido): {e}")

        job_id = str(uuid.uuid4())
        jobs[job_id] = {"status": "pending"}
        thread = threading.Thread(target=run_video_job, args=(job_id, comfy_url, workflow))
        thread.start()

        return jsonify({"job_id": job_id, "status": "pending"})

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route('/sam2/status/<job_id>', methods=['GET'])
def sam2_status(job_id):
    """Devuelve el estado actual de un job de segmentación SAM2."""
    if job_id not in jobs:
        return jsonify({"status": "not_found"}), 404
    return jsonify(jobs[job_id])

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5081)
