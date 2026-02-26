import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Load .env if present
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from src.etl.db import init_pool
from src.api.routers import games, winprob, lineups, clutch, fatigue, players, rapm, teams_router, live, playoff_simulator


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        init_pool()
        print("✓ DB pool initialized")
    except Exception as e:
        print(f"✗ DB pool FAILED: {e}")
    yield


app = FastAPI(title="SwingFactr API", version="1.0.0", lifespan=lifespan)

CORS_ORIGINS = os.environ.get(
    "CORS_ORIGINS",
    "http://localhost:3000,http://localhost:3001,https://swingfactr.vercel.app"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # open during dev
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)

app.include_router(games.router, prefix="/games", tags=["games"])
app.include_router(winprob.router, prefix="/game", tags=["win-probability"])
app.include_router(lineups.router, prefix="/team", tags=["lineups"])
app.include_router(clutch.router, prefix="/clutch", tags=["clutch"])
app.include_router(fatigue.router, prefix="/fatigue", tags=["fatigue"])
app.include_router(players.router, prefix="/players", tags=["players"])
app.include_router(rapm.router, prefix="/rapm", tags=["rapm"])
app.include_router(teams_router.router, prefix="/teams", tags=["teams"])
app.include_router(live.router, prefix="/live", tags=["live"])
app.include_router(playoff_simulator.router, prefix="/playoffs", tags=["playoffs"])


@app.get("/")
async def root():
    return {"status": "ok", "endpoints": ["/games", "/fatigue", "/team/{id}/lineup_rankings", "/clutch", "/docs"]}

@app.get("/health")
async def health():
    return {"status": "ok"}

# Global exception handler so errors show up in curl output instead of "Internal Server Error"
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    import traceback
    tb = traceback.format_exc()
    print(f"UNHANDLED ERROR on {request.url}: {tb}")
    return JSONResponse({"error": str(exc), "trace": tb}, status_code=500)
