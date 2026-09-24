"""
VertiFarmVision — ML Inference Service
MobileNetV3 plant health classifier (healthy / diseased)

Run:
    python main.py
    # or with uvicorn directly:
    uvicorn main:app --host 0.0.0.0 --port 8000

Requires Node.js 18+ in the Express backend for native fetch.
"""

import os
import base64
import io
from datetime import datetime

import torch
import torch.nn as nn
import torchvision.transforms as T
from torchvision import models
from PIL import Image
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn


# ═══════════════════════════════════════════════════════════
#  CONFIG — adjust these two lines to match your training
# ═══════════════════════════════════════════════════════════

MODEL_PATH  = os.getenv("MODEL_PATH", "mobilenetv3s_best.pth")
ARCH        = os.getenv("ARCH", "small")        # "small" or "large"

# ⚠ IMPORTANT: class order must match your ImageFolder training setup.
# PyTorch ImageFolder sorts folders alphabetically, so if your dataset
# had folders  dataset/diseased/  and  dataset/healthy/
# the order is ["diseased", "healthy"] (index 0 and 1).
# Swap if your accuracy looks inverted on test images.
CLASS_NAMES = ["diseased", "healthy"]

# ═══════════════════════════════════════════════════════════
#  DEVICE
# ═══════════════════════════════════════════════════════════

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"[ML] Using device: {DEVICE}")


# ═══════════════════════════════════════════════════════════
#  BUILD & LOAD MODEL
# ═══════════════════════════════════════════════════════════

def build_model(arch: str, num_classes: int) -> nn.Module:
    """Build MobileNetV3 with the classifier matching your training notebook."""
    if arch == "large":
        m = models.mobilenet_v3_large(weights=None)
        feat_in = 960   # large backbone output
    else:
        m = models.mobilenet_v3_small(weights=None)
        feat_in = 576   # small backbone output ← confirmed by your checkpoint

    # Rebuild classifier to exactly match your training code:
    #   classifier.0 = Linear(576, 128)
    #   classifier.1 = Hardswish
    #   classifier.2 = Dropout
    #   classifier.3 = Linear(128, num_classes)
    m.classifier = nn.Sequential(
        nn.Linear(feat_in, 128),
        nn.Hardswish(),
        nn.Dropout(p=0.2),
        nn.Linear(128, num_classes),
    )
    return m


def load_checkpoint(path: str, m: nn.Module) -> nn.Module:
    """
    Handles the three common save formats:
      1. torch.save(model.state_dict(), path)          → pure OrderedDict
      2. torch.save({'model_state_dict': ..., ...}, p) → training checkpoint
      3. torch.save(model, path)                       → full model object
    """
    ckpt = torch.load(path, map_location=DEVICE)

    if isinstance(ckpt, dict):
        # Try common training-checkpoint key names
        state = (
            ckpt.get("model_state_dict")
            or ckpt.get("state_dict")
	    or ckpt.get("model_state")
            or ckpt.get("model")
            or ckpt   # assume the whole dict IS the state dict
        )
        if isinstance(state, dict):
            m.load_state_dict(state)
        else:
            # Shouldn't happen, but guard anyway
            m = state
    else:
        # torch.save(model, ...) — entire module was saved
        m = ckpt

    return m


model = build_model(ARCH, len(CLASS_NAMES))
try:
    model = load_checkpoint(MODEL_PATH, model)
    model.eval()
    model.to(DEVICE)
    print(f"[ML] ✅ Loaded: {MODEL_PATH}  |  arch: mobilenet_v3_{ARCH}  |  classes: {CLASS_NAMES}")
except Exception as e:
    print(f"[ML] ❌ Failed to load model: {e}")
    raise


# ═══════════════════════════════════════════════════════════
#  IMAGE TRANSFORM
#  Same normalization used by all ImageNet-pretrained models
# ═══════════════════════════════════════════════════════════

transform = T.Compose([
    T.Resize((224, 224)),
    T.ToTensor(),
    T.Normalize(mean=[0.485, 0.456, 0.406],
                std =[0.229, 0.224, 0.225]),
])


# ═══════════════════════════════════════════════════════════
#  FASTAPI APP
# ═══════════════════════════════════════════════════════════

app = FastAPI(title="VertiFarmVision ML Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Schemas ──────────────────────────────────────────────────────────────────

class PredictRequest(BaseModel):
    image_base64: str   # raw base64 string — data-URI prefix is stripped if present


class PredictResponse(BaseModel):
    label:         str          # "healthy" or "diseased"
    confidence:    float        # e.g. 94.37  (percent)
    probabilities: dict         # { "healthy": 94.37, "diseased": 5.63 }
    timestamp:     str          # ISO-8601 UTC


# ── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ok",
        "model":  MODEL_PATH,
        "arch":   f"mobilenet_v3_{ARCH}",
        "device": str(DEVICE),
        "classes": CLASS_NAMES,
    }


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest):
    """
    Accepts a base64-encoded JPEG/PNG from the Express backend and
    returns the plant-health classification result.
    """
    # Strip data-URI prefix if caller included it  (data:image/jpeg;base64,...)
    b64 = req.image_base64
    if "," in b64:
        b64 = b64.split(",", 1)[1]

    # Decode image
    try:
        raw   = base64.b64decode(b64)
        image = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image data: {e}")

    # Inference
    tensor = transform(image).unsqueeze(0).to(DEVICE)
    with torch.no_grad():
        logits = model(tensor)
        probs  = torch.softmax(logits, dim=1)[0]

    pred_idx   = int(probs.argmax())
    label      = CLASS_NAMES[pred_idx]
    confidence = round(float(probs[pred_idx]) * 100, 2)
    prob_dict  = {
        CLASS_NAMES[i]: round(float(probs[i]) * 100, 2)
        for i in range(len(CLASS_NAMES))
    }

    print(f"[ML] Prediction: {label}  ({confidence}%)  |  all: {prob_dict}")

    return PredictResponse(
        label=label,
        confidence=confidence,
        probabilities=prob_dict,
        timestamp=datetime.utcnow().isoformat() + "Z",
    )


# ═══════════════════════════════════════════════════════════
#  ENTRY POINT
# ═══════════════════════════════════════════════════════════

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)
